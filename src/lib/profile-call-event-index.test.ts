/** @jest-environment node */
import {
  CallTreeEvent,
  CallTreeNode,
  CallTreeProfileBuilder,
  Frame,
  Profile,
  StackListProfileBuilder,
} from './profile'
import {CALL_EVENT_INDEX_MAX_CHECKPOINTS} from './profile-call-event-index'
import {exportProfileGroup} from './file-format'

function clipped(events: Iterable<CallTreeEvent>, left: number, right: number) {
  const active: {node: CallTreeNode; start: number; depth: number}[] = []
  const result: {node: CallTreeNode; start: number; end: number; depth: number}[] = []
  for (const event of events) {
    if (event.value >= right) break
    if (event.open) active.push({node: event.node, start: event.value, depth: active.length})
    else {
      const begin = active.pop()!
      if (event.value > left && begin.start < right && event.value > begin.start)
        result.push({
          node: begin.node,
          start: Math.max(left, begin.start),
          end: Math.min(right, event.value),
          depth: begin.depth,
        })
    }
  }
  for (const begin of active)
    if (right > Math.max(left, begin.start))
      result.push({
        node: begin.node,
        start: Math.max(left, begin.start),
        end: right,
        depth: begin.depth,
      })
  return result
}
function sameGeometry(actual: ReturnType<typeof clipped>, expected: ReturnType<typeof clipped>) {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].node).toBe(expected[i].node)
    expect([actual[i].start, actual[i].end, actual[i].depth]).toEqual([
      expected[i].start,
      expected[i].end,
      expected[i].depth,
    ])
  }
}
const a = {key: 'a', name: 'a'},
  b = {key: 'b', name: 'b'}
function many(count: number) {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < count; i++) builder.appendSampleWithWeight([i % 2 ? a : b], 0.1)
  return builder
}

test('clipped ranges preserve node identity and geometry across recursion, idle gaps and exact boundaries', async () => {
  const builder = new CallTreeProfileBuilder(25)
  builder.enterFrame(a, 2)
  builder.enterFrame(a, 3)
  builder.enterFrame(b, 4)
  builder.leaveFrame(b, 6)
  builder.leaveFrame(a, 9)
  builder.leaveFrame(a, 11)
  builder.enterFrame(b, 15)
  builder.leaveFrame(b, 20)
  const profile = builder.build(),
    before = exportProfileGroup({name: 'test', indexToView: 0, profiles: [profile]})
  const index = await profile.createCallEventRangeIndex()
  for (const [left, right] of [
    [0, 25],
    [2, 3],
    [3, 4],
    [4, 6],
    [5, 6],
    [6, 9],
    [9, 11],
    [11, 15],
    [15, 20],
    [20, 25],
    [-1, 1],
  ])
    sameGeometry(
      clipped(index.getCallEvents(left), left, right),
      clipped(profile.getCallEvents(), left, right),
    )
  expect(exportProfileGroup({name: 'test', indexToView: 0, profiles: [profile]})).toEqual(before)
})

test('checkpoint clocks preserve exact sequential floating addition at late and fractional ranges', async () => {
  const profile = many(30000).build()
  const index = await profile.createCallEventRangeIndex()
  const values = Array.from(profile.getCallEvents(), event => event.value)
  const late = values[values.length - 100]
  for (const left of [0.1, 0.2, 1.2, late, late + 0.01, profile.getTotalWeight() - 0.2])
    sameGeometry(
      clipped(index.getCallEvents(left), left, left + 0.15),
      clipped(profile.getCallEvents(), left, left + 0.15),
    )
  expect(index.checkpointCount).toBeLessThanOrEqual(CALL_EVENT_INDEX_MAX_CHECKPOINTS)
  expect(index.byteLength).toBe(index.checkpointCount * 12)
  expect(index.byteLength).toBeLessThanOrEqual(49152)
  let visits = 0
  for (const event of index.getCallEvents(late)) {
    visits++
    if (event.value > late + 0.15) break
  }
  expect(visits).toBeLessThan(100)
})

test('zero-weight samples and repeated clocks choose correct active stack at exact seek boundaries', async () => {
  // Hydration retains zero weights although ordinary builders may omit them.
  const profile = many(12000).build()
  const snapshot = profile.toSnapshot()
  for (let i = 0; i < snapshot.weights.length; i++) if (i % 7 !== 0) snapshot.weights[i] = 0
  const restored = await Profile.fromSnapshot(snapshot, {yieldControl: async () => {}})
  const index = await restored.createCallEventRangeIndex()
  let value = 0
  for (let i = 0; i < snapshot.weights.length; i++) {
    if (i % 997 === 0)
      sameGeometry(
        clipped(index.getCallEvents(value), value, value + 0.05),
        clipped(restored.getCallEvents(), value, value + 0.05),
      )
    value += snapshot.weights[i]
  }
  sameGeometry(clipped(index.getCallEvents(0), 0, 0.1), clipped(restored.getCallEvents(), 0, 0.1))
})

test('checkpoint allocation stays exact at and around the fixed production cap', async () => {
  for (const count of [4095, 4096, 4097, 8193]) {
    const profile = many(count).build()
    const index = await profile.createCallEventRangeIndex()
    const expected = Math.ceil(count / Math.max(1, Math.ceil(count / 4096)))
    expect(index.checkpointCount).toBe(expected)
    expect(index.byteLength).toBe(expected * 12)
    expect(index.byteLength).toBeLessThanOrEqual(49152)
    const left = profile.getTotalWeight() - 0.05
    sameGeometry(
      clipped(index.getCallEvents(left), left, left + 0.04),
      clipped(profile.getCallEvents(), left, left + 0.04),
    )
  }
})

test('deterministic varied stacks and viewport endpoints agree with full sequential traversal', async () => {
  const builder = new StackListProfileBuilder()
  let seed = 123456
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  const frames = Array.from({length: 5}, (_, i) => ({key: i, name: String(i)}))
  for (let i = 0; i < 12000; i++) {
    const depth = random() % 8
    const stack = Array.from({length: depth}, () => frames[random() % frames.length])
    builder.appendSampleWithWeight(stack, [0.1, 0.2, 0.3, 1, 2][random() % 5])
  }
  const profile = builder.build(),
    index = await profile.createCallEventRangeIndex()
  for (let i = 0; i < 35; i++) {
    const left = (random() / 0xffffffff) * profile.getTotalWeight()
    const right = Math.min(profile.getTotalWeight(), left + ((random() % 7) + 1) * 0.13)
    sameGeometry(
      clipped(index.getCallEvents(left), left, right),
      clipped(profile.getCallEvents(), left, right),
    )
  }
})

test('late checkpoint reconstructs deeply nested ancestors without storing checkpoint ancestor arrays', async () => {
  const builder = new StackListProfileBuilder()
  const frames = Array.from({length: 20000}, (_, key) => ({key, name: `f${key}`}))
  builder.appendSampleWithWeight([a], 1)
  builder.appendSampleWithWeight(frames, 2)
  const profile = builder.build(),
    index = await profile.createCallEventRangeIndex()
  const events = index.getCallEvents(2)
  let opens = 0
  for (const event of events) {
    if (!event.open) break
    opens++
  }
  expect(opens).toBe(20000)
  expect(index.checkpointCount).toBe(2)
  expect(index.byteLength).toBe(24)
  const geometry = clipped(index.getCallEvents(2), 2, 2.5)
  expect(geometry.length).toBe(20000)
  expect(geometry.every(item => item.start === 2 && item.end === 2.5)).toBe(true)
})

test('empty profiles, root-only idle, invalid seeks and invalid source weights are explicit', async () => {
  const empty = await new StackListProfileBuilder().build().createCallEventRangeIndex()
  expect(empty.checkpointCount).toBe(0)
  expect(empty.byteLength).toBe(0)
  expect(Array.from(empty.getCallEvents(0))).toEqual([])
  const idle = new StackListProfileBuilder()
  idle.appendSampleWithWeight([], 3)
  expect(Array.from((await idle.build().createCallEventRangeIndex()).getCallEvents(2))).toEqual([])
  for (const value of [NaN, Infinity, -Infinity])
    expect(() => Array.from(empty.getCallEvents(value))).toThrow('finite')
  // The range-index validator is also defensive for unfinished/importer sources.
  const bad = new Profile() as any
  bad.samples = [new CallTreeNode(Frame.root, null)]
  bad.weights = [-1]
  await expect(bad.createCallEventRangeIndex()).rejects.toThrow('nonnegative')
})

test('cooperative build cancellation releases bounded work and never returns a partial index', async () => {
  const profile = many(20000).build()
  const controller = new AbortController()
  controller.abort()
  await expect(
    profile.createCallEventRangeIndex({signal: controller.signal}),
  ).rejects.toHaveProperty('name', 'AbortError')
  const during = new AbortController()
  let yields = 0
  await expect(
    profile.createCallEventRangeIndex({
      signal: during.signal,
      yieldControl: async () => {
        yields++
        during.abort()
      },
    }),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(yields).toBe(1)
})

test('resuming a builder invalidates cached index instead of seeking with stale checkpoints', async () => {
  const builder = many(10),
    profile = builder.build()
  const index = await profile.createCallEventRangeIndex()
  builder.appendSampleWithWeight([b], 2)
  builder.build()
  expect(() => Array.from(index.getCallEvents(1))).toThrow('changed')
  const merging = new StackListProfileBuilder(100)
  merging.appendSampleWithWeight([a], 1)
  const merged = await merging.build().createCallEventRangeIndex()
  merging.appendSampleWithWeight([a], 1)
  merging.build() // Same sample count and recording total, changed final weight.
  expect(() => Array.from(merged.getCallEvents(1))).toThrow('changed')
  const other = many(10000),
    finished = other.build()
  await expect(
    finished.createCallEventRangeIndex({
      yieldControl: async () => {
        other.appendSampleWithWeight([a], 1)
        other.build()
      },
    }),
  ).rejects.toThrow('changed')
})
