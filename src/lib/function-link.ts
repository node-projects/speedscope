import {Frame, FrameInfo, Profile} from './profile'

const remoteSources = new WeakMap<Profile, {url: string; accepts?: string}>()
export function rememberFunctionLinkSource(
  profiles: readonly Profile[],
  url: string,
  accepts?: string,
) {
  for (const profile of profiles) remoteSources.set(profile, {url, accepts})
}

// Versioned source identity, independent of importer-assigned frame keys.
export interface FunctionSelection {
  v: 1
  profileIndex: number
  profileName: string
  unit: string
  totalWeight: number
  frame: {name: string; file?: string; line?: number; col?: number}
}

export function parseFunctionSelection(text: string): FunctionSelection | undefined {
  if (text.length > 8192) return undefined
  try {
    const value = JSON.parse(text)
    const f = value?.frame
    const optionalPosition = (n: unknown) =>
      n === undefined || (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    if (
      value?.v !== 1 ||
      !Number.isSafeInteger(value.profileIndex) ||
      value.profileIndex < 0 ||
      typeof value.profileName !== 'string' ||
      typeof value.unit !== 'string' ||
      typeof value.totalWeight !== 'number' ||
      !Number.isFinite(value.totalWeight) ||
      value.totalWeight < 0 ||
      !f ||
      typeof f.name !== 'string' ||
      (f.file !== undefined && typeof f.file !== 'string') ||
      !optionalPosition(f.line) ||
      !optionalPosition(f.col)
    )
      return undefined
    return {
      v: 1,
      profileIndex: value.profileIndex,
      profileName: value.profileName,
      unit: value.unit,
      totalWeight: value.totalWeight,
      frame: {name: f.name, file: f.file, line: f.line, col: f.col},
    }
  } catch {
    return undefined
  }
}

function sameSource(a: FrameInfo, b: FunctionSelection['frame']) {
  return a.name === b.name && a.file === b.file && a.line === b.line && a.col === b.col
}

export function resolveFunctionSelection(
  profiles: readonly Profile[],
  selection: FunctionSelection,
): Frame | null {
  const profile = profiles[selection.profileIndex]
  if (
    !profile ||
    profile.isDerived() ||
    profile.getName() !== selection.profileName ||
    profile.getWeightUnit() !== selection.unit ||
    profile.getTotalWeight() !== selection.totalWeight
  )
    return null
  let result: Frame | null = null
  for (const frame of profile.getFrames()) {
    if (!sameSource(frame, selection.frame)) continue
    if (result) return null // Never silently choose between identical source identities.
    result = frame
  }
  return result
}

export function createFunctionLink(
  currentURL: string,
  profiles: readonly Profile[],
  profileIndex: number,
  frame: FrameInfo,
): string {
  const profile = profiles[profileIndex]
  if (!profile || profile.isDerived())
    throw new Error(
      'Function links require an original profile. Export and reopen a derived profile first.',
    )
  if ([profile.getName(), frame.name, frame.file || ''].some(value => value.length > 8192))
    throw new Error('This function identity is too long to include in a link.')
  const selection: FunctionSelection = {
    v: 1,
    profileIndex,
    profileName: profile.getName(),
    unit: profile.getWeightUnit(),
    totalWeight: profile.getTotalWeight(),
    frame: {name: frame.name, file: frame.file, line: frame.line, col: frame.col},
  }
  const encoded = JSON.stringify(selection)
  if (!parseFunctionSelection(encoded))
    throw new Error('This function identity is unsupported or too long to include in a link.')
  if (!resolveFunctionSelection(profiles, selection))
    throw new Error('This function does not have a unique source identity in the original profile.')
  const url = new URL(currentURL)
  // Match the existing hash parser: literal plus signs are not spaces.
  const old = new URLSearchParams(url.hash.slice(1).replace(/\+/g, '%2B'))
  const params = new URLSearchParams()
  const source = remoteSources.get(profile)
  if (source && /^https?:\/\//i.test(source.url)) {
    params.set('profileURL', source.url)
    if (source.accepts) params.set('profileAccepts', source.accepts)
  }
  const title = old.get('title')
  if (title) params.set('title', title)
  params.set('view', 'sandwich')
  params.set('selection', encoded)
  url.hash = params.toString().replace(/\+/g, '%20')
  if (url.href.length > 65536) throw new Error('This recording URL is too long to share.')
  return url.href
}
