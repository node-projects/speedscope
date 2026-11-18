import {
  CallTreeNode,
  CallTreeProfileBuilder,
  FrameInfo,
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
          key: JSON.stringify([frame.name, frame.file, frame.line, frame.col]),
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
