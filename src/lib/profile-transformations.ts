import {
  CallTreeNode,
  CallTreeProfileBuilder,
  FrameInfo,
  Frame,
  Profile,
  StackListProfileBuilder,
} from './profile'

export function isDerivedProfile(profile: Profile): boolean {
  return profile.isDerived()
}

function finish(builder: Profile, source: Profile, name: string, chronological = false): Profile {
  builder.setName(name)
  builder.setValueFormatter({unit: source.getWeightUnit(), format: source.formatValue.bind(source)})
  builder.setDerived(true)
  builder.setChronological(chronological)
  return builder
}

export function cropProfile(profile: Profile, start: number, end: number): Profile {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('Select a non-empty time range to crop')
  start = Math.max(0, Math.min(profile.getTotalWeight(), start))
  end = Math.max(start, Math.min(profile.getTotalWeight(), end))
  const builder = new CallTreeProfileBuilder(end - start)
  const included = new Set<CallTreeNode>()
  const clamp = (value: number) => Math.max(0, Math.min(end - start, value - start))
  profile.forEachCall(
    (node, value) => {
      if (value < end && value + node.getTotalWeight() > start) {
        included.add(node)
        builder.enterFrame(node.frame, clamp(value))
      }
    },
    (node, value) => {
      if (included.delete(node)) builder.leaveFrame(node.frame, clamp(value))
    },
  )
  return finish(
    builder.build(),
    profile,
    `${profile.getName()} [${profile.formatValue(start)}–${profile.formatValue(end)}]`,
    profile.isChronological(),
  )
}

function forEachWeightedStack(
  profile: Profile,
  append: (stack: FrameInfo[], weight: number) => void,
) {
  const stack: FrameInfo[] = []
  let previous = 0
  function emit(value: number) {
    if (value > previous && stack.length) append(stack, value - previous)
    previous = value
  }
  // These transforms aggregate stacks, so visit each grouped path once rather
  // than reprocessing every occurrence in the original recording.
  profile.forEachCallGrouped(
    (node, value) => {
      emit(value)
      stack.push(node.frame)
    },
    (_node, value) => {
      emit(value)
      stack.pop()
    },
  )
}

export function combineProfiles(profiles: Profile[]): Profile {
  const originals = profiles.filter(profile => !isDerivedProfile(profile))
  if (!originals.length) throw new Error('No original profiles to combine')
  if (originals.some(profile => profile.getWeightUnit() !== originals[0].getWeightUnit())) {
    throw new Error('Profiles with different units cannot be combined')
  }
  const builder = new StackListProfileBuilder()
  for (const profile of originals) {
    forEachWeightedStack(profile, (stack, weight) =>
      builder.appendSampleWithWeight(
        stack.map(frame => ({
          ...frame,
          key: JSON.stringify([
            frame.name,
            frame.file,
            frame.line,
            frame.col,
            ...(frame.color ? [frame.color.toLowerCase()] : []),
          ]),
        })),
        weight,
      ),
    )
  }
  return finish(builder.build(), originals[0], `All ${originals.length} profiles (combined)`)
}

export function invertProfile(profile: Profile): Profile {
  const builder = new StackListProfileBuilder()
  forEachWeightedStack(profile, (stack, weight) =>
    builder.appendSampleWithWeight(stack.slice().reverse(), weight),
  )
  return finish(builder.build(), profile, `${profile.getName()} [inverted stacks]`)
}

export function groupProfileByFile(profile: Profile): Profile {
  const builder = new StackListProfileBuilder()
  forEachWeightedStack(profile, (stack, weight) => {
    const files: FrameInfo[] = []
    for (const frame of stack) {
      const file = frame.file || '(unknown file)'
      if (!files.length || files[files.length - 1].key !== file)
        files.push({key: file, name: file, file})
    }
    builder.appendSampleWithWeight(files, weight)
  })
  return finish(builder.build(), profile, `${profile.getName()} [grouped by file]`)
}

export interface ProfileFilterRules {
  field: 'file' | 'name' | 'either'
  include: string[]
  exclude: string[]
}
export interface ProfileFilterOptions {
  signal?: AbortSignal
  onProgress?: () => void
  yieldControl?: () => Promise<void>
}

// Hide individual frames, retaining the weight of each remaining stack. A
// removed leaf contributes self weight to its nearest remaining ancestor.
// Fully removed stacks (and source idle weight) are omitted, never invented.
export async function filterProfile(
  source: Profile,
  rules: ProfileFilterRules,
  options: ProfileFilterOptions = {},
): Promise<Profile> {
  const field = rules.field
  if (!['file', 'name', 'either'].includes(field)) throw new Error('Invalid filter field')
  const include = rules.include.map(s => s.trim()).filter(Boolean)
  const exclude = rules.exclude.map(s => s.trim()).filter(Boolean)
  if (!include.length && !exclude.length) throw new Error('Enter an include or exclude rule')
  if (include.length + exclude.length > 128 || [...include, ...exclude].join('\n').length > 4096)
    throw new Error('Use at most 128 rules and 4,096 characters')
  const normalize = (value: string) => value.replace(/\\/g, '/').toLocaleLowerCase()
  const includePatterns = include.map(normalize)
  const excludePatterns = exclude.map(normalize)
  const matches = (frame: Frame, patterns: string[]) => {
    if (!patterns.length) return false
    const values: string[] = []
    if (field !== 'file') values.push(normalize(frame.name))
    if (field !== 'name' && frame.file) values.push(normalize(frame.file))
    return patterns.some(pattern => values.some(value => value.includes(pattern)))
  }
  const cache = new Map<Frame, boolean>()
  const keep = (frame: Frame) => {
    let result = cache.get(frame)
    if (result === undefined) {
      result =
        (!includePatterns.length || matches(frame, includePatterns)) &&
        !matches(frame, excludePatterns)
      cache.set(frame, result)
    }
    return result
  }
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Filter cancelled', 'AbortError')
  }
  const pause = async () => {
    checkAbort()
    options.onProgress?.()
    checkAbort()
    await (options.yieldControl
      ? options.yieldControl()
      : new Promise(resolve => setTimeout(resolve, 0)))
    checkAbort()
  }
  await pause()
  const builder = new StackListProfileBuilder()
  const path: FrameInfo[] = []
  const visit = [{node: source.getGroupedCalltreeRoot(), index: -1, kept: false}]
  let work = 0
  while (visit.length) {
    const current = visit[visit.length - 1]
    if (current.index === -1) {
      current.kept = !current.node.isRoot() && keep(current.node.frame)
      if (current.kept) path.push(current.node.frame)
      const weight = current.node.getSelfWeight()
      if (path.length && weight > 0) {
        builder.appendSampleWithWeight(path, weight)
        work += path.length
      }
      current.index = 0
    }
    if (current.index < current.node.children.length) {
      visit.push({node: current.node.children[current.index++], index: -1, kept: false})
    } else {
      if (current.kept) path.pop()
      visit.pop()
    }
    if (++work >= 8192) {
      work = 0
      await pause()
    }
  }
  await pause()
  const description = [
    include.length ? `include ${JSON.stringify(include)}` : '',
    exclude.length ? `exclude ${JSON.stringify(exclude)}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  return finish(builder.build(), source, `${source.getName()} [filter ${field}: ${description}]`)
}
