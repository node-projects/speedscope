import {FrameInfo, Profile, StackListProfileBuilder} from './profile'
import {ByteFormatter} from './value-formatters'
import {compareProfiles, comparisonNodePage, PROFILE_COMPARISON_LIMITS} from './profile-comparison'

function frame(name: string, key: string = name, file = 'source.ts'): FrameInfo {
  return {name, key, file, line: 1, col: 2}
}
function profile(samples: [FrameInfo[], number][], name = 'recording'): Profile {
  const builder = new StackListProfileBuilder()
  builder.setName(name)
  for (const [stack, value] of samples) builder.appendSampleWithWeight(stack, value)
  return builder.build()
}
const absolute = {mode: 'absolute' as const}

test('compares source identities rather than importer keys and merges equal siblings', async () => {
  const baseline = profile([
    [[frame('work', 'a')], 2],
    [[frame('work', 'b')], 3],
    [[frame('work', 'c', 'other.ts')], 1],
  ])
  const candidate = profile([[[frame('work', 'new-key')], 8]])
  const before = baseline.toSnapshot()
  const result = await compareProfiles(baseline, candidate, absolute)
  expect(result.nodes).toHaveLength(3)
  const work = result.root.children[0]
  expect(work.frame).toEqual({name: 'work', file: 'source.ts', line: 1, col: 2})
  expect(work.baselineTotal).toBe(5)
  expect(work.candidateTotal).toBe(8)
  expect(work.totalDelta).toBe(3)
  expect(work.selfDelta).toBe(3)
  expect(result.root.children[1].totalDelta).toBe(-1)
  expect(baseline.toSnapshot()).toEqual(before)
  expect(work.frame).not.toHaveProperty('key')
})

test('preserves recursive call paths and source positions', async () => {
  const a = frame('recursive')
  const baseline = profile([
    [[a, a], 2],
    [[frame('other'), a], 3],
    [[{...a, key: 'line', line: 2}], 4],
    [[{...a, key: 'column', col: 3}], 5],
  ])
  const result = await compareProfiles(baseline, baseline, absolute)
  expect(result.nodes).toHaveLength(7)
  const recursive = result.root.children.find(
    item => item.frame?.name === a.name && item.frame.col === 2 && item.frame.line === 1,
  )!
  expect(recursive.children[0].frame).toBe(recursive.frame)
  expect(recursive.children[0].parent).toBe(recursive)
  expect(result.nodes.every(item => item.totalDelta === 0)).toBe(true)
})

test('envelope includes redistribution and prioritizes largest candidate paths', async () => {
  const baseline = profile([[[frame('old')], 10]])
  const candidate = profile([[[frame('new')], 20]])
  const result = await compareProfiles(baseline, candidate, absolute)
  expect(result.root.envelope).toBe(30)
  expect(result.root.totalDelta).toBe(10)
  expect(result.maxAbsDelta).toBe(20)
  expect(result.root.children.map(item => item.frame?.name)).toEqual(['new', 'old'])
})

test('normalizes each full total including idle and retains original metadata', async () => {
  const baseline = profile(
    [
      [[frame('a')], 2],
      [[], 2],
    ],
    'before',
  )
  const candidate = profile(
    [
      [[frame('a')], 3],
      [[], 9],
    ],
    'after',
  )
  candidate.setValueFormatter(new ByteFormatter())
  await expect(compareProfiles(baseline, candidate, absolute)).rejects.toThrow('matching units')
  const result = await compareProfiles(baseline, candidate, {mode: 'normalized'})
  expect(result.baselineTotal).toBe(4)
  expect(result.candidateTotal).toBe(12)
  expect(result.baselineName).toBe('before')
  expect(result.candidateName).toBe('after')
  expect(result.unit).toBe('none')
  expect(result.candidateUnit).toBe('bytes')
  expect(result.root.baselineSelf).toBe(0.5)
  expect(result.root.candidateSelf).toBe(0.75)
  expect(result.root.children[0].totalDelta).toBe(-0.25)
  expect(result.root.totalDelta).toBe(0)
  expect(result.root.envelope).toBe(1.25)
})

test('handles zero totals and subnormal fractions without reciprocal overflow', async () => {
  const empty = profile([])
  const tiny = profile([[[frame('tiny')], Number.MIN_VALUE]])
  const result = await compareProfiles(empty, tiny, {mode: 'normalized'})
  expect(result.root.baselineTotal).toBe(0)
  expect(result.root.candidateTotal).toBe(1)
  expect(result.root.children[0].candidateTotal).toBe(1)
  expect(result.nodes.every(item => Number.isFinite(item.envelope))).toBe(true)
})

test('rejects absolute envelope overflow and supports normalized comparison instead', async () => {
  const baseline = profile([[[frame('old')], 1e308]])
  const candidate = profile([[[frame('new')], 1e308]])
  await expect(compareProfiles(baseline, candidate, absolute)).rejects.toThrow('overflow')
  const result = await compareProfiles(baseline, candidate, {mode: 'normalized'})
  expect(result.root.envelope).toBe(2)
})

test('handles deep recursive profiles iteratively and pages a bounded result', async () => {
  const deep = profile([[Array.from({length: 20000}, () => frame('recursive')), 1]])
  const result = await compareProfiles(deep, deep, absolute)
  expect(result.nodes).toHaveLength(20001)
  expect(result.nodes[20000].depth).toBe(20000)
  expect(result.nodes[20000].selfDelta).toBe(0)
  expect(comparisonNodePage(result, 100, 200)).toMatchObject({total: 20001, nextOffset: 300})
  expect(comparisonNodePage(result, 20000, 200).nodes).toHaveLength(1)
  expect(comparisonNodePage(result, 30000).nodes).toHaveLength(0)
  expect(() => comparisonNodePage(result, 0, 201)).toThrow('invalid result page')
})

test('rejects resource excess instead of returning truncated comparison', async () => {
  const wide = profile(Array.from({length: 30}, (_, i) => [[frame(String(i))], 1]))
  await expect(compareProfiles(wide, wide, {...absolute, maxNodes: 30})).rejects.toThrow(
    'union exceeds 30',
  )
  for (const maxNodes of [0, 0.5, PROFILE_COMPARISON_LIMITS.nodes + 1])
    await expect(compareProfiles(wide, wide, {...absolute, maxNodes})).rejects.toThrow(
      'invalid node limit',
    )
  const hugeName = profile([
    [[frame('\u0000'.repeat(PROFILE_COMPARISON_LIMITS.identityLength + 1))], 1],
  ])
  await expect(compareProfiles(hugeName, hugeName, absolute)).rejects.toThrow('identity text')
})

test('rejects nonfinite/negative source weights and invalid identity metadata', async () => {
  for (const invalid of [NaN, Infinity, -1]) {
    const input = profile([[[frame('a')], 1]])
    jest
      .spyOn(input.getGroupedCalltreeRoot().children[0], 'getSelfWeight')
      .mockImplementation(() => invalid)
    await expect(compareProfiles(input, input, absolute)).rejects.toThrow('finite and nonnegative')
  }
  const invalidPosition = profile([[[{...frame('a'), line: Infinity}], 1]])
  await expect(compareProfiles(invalidPosition, invalidPosition, absolute)).rejects.toThrow(
    'invalid source identity',
  )
})

test('supports abort before work and during a large comparison timer yield', async () => {
  const input = profile(Array.from({length: 10000}, (_, i) => [[frame(String(i))], 1]))
  const before = new AbortController()
  before.abort()
  await expect(
    compareProfiles(input, input, {...absolute, signal: before.signal}),
  ).rejects.toHaveProperty('name', 'AbortError')
  const during = new AbortController()
  const pending = compareProfiles(input, input, {...absolute, signal: during.signal})
  setTimeout(() => during.abort(), 0)
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
})
