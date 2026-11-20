import {Frame, Profile} from './profile'
import {createTextMatcher, SearchMode} from './profile-search'

export interface ProfileSearchMatch {
  profileIndex: number
  profile: Profile
  frame: Frame
}
export interface MultiProfileSearchResult {
  matches: ProfileSearchMatch[]
  truncated: boolean
}
export async function searchProfiles(
  profiles: readonly Profile[],
  query: string,
  options: {
    mode?: SearchMode
    includeDerived?: boolean
    limit?: number
    signal?: AbortSignal
    yieldControl?: () => Promise<void>
  } = {},
): Promise<MultiProfileSearchResult> {
  const limit = options.limit ?? 200
  const sources = profiles.slice()
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid search limit')
  if (query.length > 4096) throw new Error('Use at most 4,096 search characters')
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
  }
  const pause = async () => {
    checkAbort()
    await (options.yieldControl
      ? options.yieldControl()
      : new Promise(resolve => setTimeout(resolve, 0)))
    checkAbort()
  }
  await pause()
  const matches: ProfileSearchMatch[] = []
  if (!query.trim()) return {matches, truncated: false}
  const matcher = createTextMatcher(query, options.mode ?? SearchMode.SUBSTRING)
  let work = 0
  for (let profileIndex = 0; profileIndex < sources.length; profileIndex++) {
    const profile = sources[profileIndex]
    if (profile.isDerived() && !options.includeDerived) continue
    for (const frame of profile.getFrames()) {
      if (matcher.hasMatch(frame.name) || (frame.file && matcher.hasMatch(frame.file))) {
        if (matches.length === limit) {
          await pause()
          return {matches, truncated: true}
        }
        matches.push({profileIndex, profile, frame})
      }
      work += 1 + Math.ceil((frame.name.length + (frame.file?.length || 0)) / 256)
      if (work >= 4096) {
        work = 0
        await pause()
      }
    }
  }
  await pause()
  return {matches, truncated: false}
}
