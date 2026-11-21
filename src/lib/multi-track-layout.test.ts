import {CallTreeProfileBuilder, Profile, StackListProfileBuilder} from './profile'
import {TimeFormatter} from './value-formatters'
import {
  buildMultiTrackLayout,
  clampMultiTrackViewport,
  collectTrackTiles,
  MULTI_TRACK_DEPTH,
  multiTrackAxisTicks,
} from './multi-track-layout'

function profile(start?: number, clock = 'recording-A') {
  const builder = new CallTreeProfileBuilder(20)
  builder.enterFrame({key: 'outer', name: 'outer'}, 2)
  builder.enterFrame({key: 'inner', name: 'inner'}, 5)
  builder.leaveFrame({key: 'inner', name: 'inner'}, 10)
  builder.leaveFrame({key: 'outer', name: 'outer'}, 15)
  const result = builder.build()
  result.setValueFormatter(new TimeFormatter('microseconds'))
  if (start !== undefined) result.setTimelineOrigin({clock, start})
  return result
}

test('only explicit chronological shared-clock origins align; units and clocks form separate groups', () => {
  const earlier = profile(100),
    later = profile(107),
    unanchored = profile()
  const otherClock = profile(100, 'recording-B'),
    otherUnit = profile(100)
  otherUnit.setValueFormatter(new TimeFormatter('milliseconds'))
  otherUnit.setTimelineOrigin({clock: 'recording-A', start: 100})
  const derived = profile(100)
  derived.setDerived(true)
  const aggregate = profile(100)
  aggregate.setChronological(false)
  const layout = buildMultiTrackLayout([
    later,
    earlier,
    unanchored,
    otherClock,
    otherUnit,
    derived,
    aggregate,
  ])
  expect(layout.groups).toHaveLength(3)
  expect(layout.groups[0].referenceStart).toBe(100)
  expect(layout.groups[0].tracks.map(track => track.offset)).toEqual([7, 0])
  expect(layout.groups[0].span).toBe(27)
  expect(layout.excluded.map(item => item.profileIndex)).toEqual([2, 5, 6])
  expect(layout.excluded[0].reason).toContain('explicit')
})

test('nonfinite durations and overflowing clock differences are excluded, zero extents clamp safely', () => {
  const bad = profile(0)
  jest.spyOn(bad, 'getTotalWeight').mockImplementation(() => Infinity)
  const layout = buildMultiTrackLayout([profile(-1e308), profile(1e308), bad])
  expect(layout.groups[0].tracks).toHaveLength(1)
  expect(layout.excluded).toHaveLength(2)
  const empty = new StackListProfileBuilder().build()
  empty.setValueFormatter(new TimeFormatter('microseconds'))
  empty.setTimelineOrigin({clock: 'empty', start: 1e12})
  const group = buildMultiTrackLayout([empty]).groups[0]
  expect(clampMultiTrackViewport(group, {left: NaN, width: Infinity})).toEqual({left: 0, width: 1})
  expect(clampMultiTrackViewport(group, {left: Infinity, width: 0}).width).toBeGreaterThan(0)
})

test('inspection metadata is bounded without examining hidden profiles', () => {
  const ordinary = profile(0),
    hidden = profile(0)
  const origin = jest.spyOn(hidden, 'getTimelineOrigin')
  const layout = buildMultiTrackLayout([...Array<Profile>(10000).fill(ordinary), hidden])
  expect(layout.groups[0].tracks).toHaveLength(10000)
  expect(layout.uninspectedCount).toBe(1)
  expect(origin).not.toHaveBeenCalled()
})

test('shared axis labels remain separated after zooming and on narrow viewports', () => {
  for (const width of [220, 800, 1300]) {
    const viewport = {left: 350, width: 500}
    const ticks = multiTrackAxisTicks(viewport, width, 'milliseconds')
    const format = new TimeFormatter('milliseconds')
    for (let i = 1; i < ticks.positions.length; i++) {
      const spacing = ((ticks.positions[i] - ticks.positions[i - 1]) / viewport.width) * width
      const text = format.format(ticks.positions[i - 1], ticks.interval)
      expect(spacing).toBeGreaterThanOrEqual(text.length * 7 + 12)
    }
    expect(ticks.positions.length).toBeLessThanOrEqual(100)
  }
})

test('nonfinite geometry limits retain the hard rectangle bound', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 13000; i++) builder.appendSampleWithWeight([{key: i, name: `call ${i}`}], 1)
  const result = await collectTrackTiles(
    {profile: builder.build(), profileIndex: 0, offset: 0},
    {left: 0, width: 13000},
    {maxTiles: NaN},
  )
  expect(result.tiles).toHaveLength(12000)
  expect(result.omitted).toBe(1000)
})

test('viewport extraction clips crossing calls with aligned offsets and retains idle gaps', async () => {
  const track = {profile: profile(0), profileIndex: 0, offset: 7}
  const result = await collectTrackTiles(track, {left: 11, width: 4})
  expect(
    result.tiles.map(tile => [tile.node.frame.name, tile.depth, tile.start, tile.end]),
  ).toEqual([
    ['outer', 0, 11, 15],
    ['inner', 1, 12, 15],
  ])
  expect((await collectTrackTiles(track, {left: 23, width: 3})).tiles).toHaveLength(0)
  expect((await collectTrackTiles(track, {left: 0, width: 4})).eventsVisited).toBe(0)
})

test('geometry and displayed depth are bounded with explicit omission counts', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 100; i++) builder.appendSampleWithWeight([{key: i, name: `call ${i}`}], 1)
  const wide = await collectTrackTiles(
    {profile: builder.build(), profileIndex: 0, offset: 0},
    {left: 0, width: 100},
    {maxTiles: 5},
  )
  expect(wide.tiles).toHaveLength(5)
  expect(wide.omitted).toBe(95)
  const deep = new StackListProfileBuilder()
  deep.appendSampleWithWeight(
    Array.from({length: 20000}, (_, key) => ({key, name: `depth ${key}`})),
    10,
  )
  const result = await collectTrackTiles(
    {profile: deep.build(), profileIndex: 0, offset: 0},
    {left: 5, width: 15},
  )
  expect(result.tiles).toHaveLength(MULTI_TRACK_DEPTH)
  expect(result.deeper).toBe(true)
  expect(Math.max(...result.tiles.map(tile => tile.depth))).toBe(MULTI_TRACK_DEPTH - 1)
})

test('bounded retention keeps longest late calls and parents closing after many short children', async () => {
  const sampled = new StackListProfileBuilder()
  for (let i = 1; i <= 100; i++) sampled.appendSampleWithWeight([{key: i, name: `${i}`}], i)
  const largest = await collectTrackTiles(
    {profile: sampled.build(), profileIndex: 0, offset: 0},
    {left: 0, width: 5050},
    {maxTiles: 5},
  )
  expect(largest.tiles.map(tile => tile.end - tile.start).sort((a, b) => a - b)).toEqual([
    96, 97, 98, 99, 100,
  ])
  expect(largest.omitted).toBe(95)
  const nested = new CallTreeProfileBuilder(1000)
  const parent = {key: 'parent', name: 'long parent'}
  nested.enterFrame(parent, 0)
  for (let i = 0; i < 1000; i++) {
    const child = {key: i, name: `short ${i}`}
    nested.enterFrame(child, i)
    nested.leaveFrame(child, i + 0.5)
  }
  nested.leaveFrame(parent, 1000)
  const overview = await collectTrackTiles(
    {profile: nested.build(), profileIndex: 0, offset: 0},
    {left: 0, width: 1000},
    {maxTiles: 21},
  )
  expect(overview.tiles.find(tile => tile.node.frame.name === 'long parent')).toMatchObject({
    depth: 0,
    start: 0,
    end: 1000,
  })
  const retainedChildren = overview.tiles.filter(tile => tile.depth === 1)
  expect(retainedChildren).toHaveLength(20)
  expect(Math.min(...retainedChildren.map(tile => tile.start))).toBeLessThan(250)
  expect(Math.max(...retainedChildren.map(tile => tile.end))).toBeGreaterThan(750)
  expect(overview.omitted).toBe(980)
})

test('long scans yield and cancel before processing the remaining recording', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 10000; i++) builder.appendSampleWithWeight([{key: i, name: `call ${i}`}], 1)
  const controller = new AbortController()
  let now = 0
  jest.spyOn(performance, 'now').mockImplementation(() => (now += 9))
  const pause = jest.fn(async () => {
    controller.abort()
  })
  try {
    await expect(
      collectTrackTiles(
        {profile: builder.build(), profileIndex: 0, offset: 0},
        {left: 9000, width: 1000},
        {signal: controller.signal, yieldControl: pause},
      ),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(pause).toHaveBeenCalledTimes(1)
  } finally {
    jest.restoreAllMocks()
  }
})

test('cold and warm range seeking preserve clipped node geometry, heap choices and zero-weight boundaries', async () => {
  const builder = new StackListProfileBuilder()
  const outer = {key: 'outer', name: 'outer'}
  for (let i = 0; i < 12000; i++) {
    builder.appendSampleWithWeight(
      [outer, {key: i % 7, name: `branch ${i % 7}`}, {key: `leaf${i}`, name: `leaf ${i}`}],
      i % 11 === 0 ? 0 : ((i % 5) + 1) / 10,
    )
  }
  const input = builder.build()
  const track = {profile: input, profileIndex: 0, offset: 123.25}
  const rangeIndex = await input.createCallEventRangeIndex()
  for (const start of [input.getTotalWeight() * 0.8, input.getTotalWeight() - 10, 0.1]) {
    const viewport = {left: start + track.offset, width: 5}
    const full = await collectTrackTiles(track, viewport, {maxTiles: 17})
    const seek = await collectTrackTiles(track, viewport, {maxTiles: 17, rangeIndex})
    const warm = await collectTrackTiles(track, viewport, {maxTiles: 17, rangeIndex})
    expect(seek.tiles).toEqual(full.tiles)
    expect(warm.tiles).toEqual(full.tiles)
    expect(seek.omitted).toBe(full.omitted)
    expect(seek.deeper).toBe(full.deeper)
    if (start > input.getTotalWeight() / 2)
      expect(seek.eventsVisited).toBeLessThan(full.eventsVisited / 10)
    seek.tiles.forEach((tile, i) => expect(tile.node).toBe(full.tiles[i].node))
  }
})

test('zero-duration deep samples at a seek boundary do not change real visible depth markers', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 'before', name: 'before'}], 1)
  builder.appendSampleWithWeight(
    Array.from({length: 20}, (_, key) => ({key, name: `zero ${key}`})),
    1,
  )
  builder.appendSampleWithWeight([{key: 'after', name: 'after'}], 1)
  const snapshot = builder.build().toSnapshot()
  snapshot.weights[1] = 0
  snapshot.totalWeight = 2
  const input = await Profile.fromSnapshot(snapshot)
  const track = {profile: input, profileIndex: 0, offset: 0}
  const viewport = {left: 1, width: 0.5}
  const full = await collectTrackTiles(track, viewport)
  const seek = await collectTrackTiles(track, viewport, {
    rangeIndex: await input.createCallEventRangeIndex(),
  })
  expect(seek.tiles).toEqual(full.tiles)
  expect(seek.deeper).toBe(full.deeper)
  expect(seek.deeper).toBe(false)
})
