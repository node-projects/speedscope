import {InstantTrack} from './instant-track'
import {buildMultiTrackLayout, clampMultiTrackViewport} from './multi-track-layout'
import {
  collectInstantGlyphs,
  instantEventRange,
  instantEventsNear,
  InstantTimelineRow,
  MAX_VISIBLE_INSTANT_GLYPHS,
} from './instant-track-layout'

function row(times: number[], offset = 0): InstantTimelineRow {
  const instant: InstantTrack = {
    id: 'events',
    name: 'Events',
    scope: 'thread',
    clock: 'wall',
    timeUnit: 'microseconds',
    start: 100,
    times: Float64Array.from(times),
    events: times.map((_, i) => ({name: `event ${i}`})),
  }
  return {kind: 'instant', instant, instantIndex: 0, offset}
}

test('aligned fractional bounds preserve every coincident point and source ordering', () => {
  const input = row([0, 0.2, 0.2, 0.4], 1)
  expect(instantEventRange(input, {left: 1.2, width: 0.2})).toEqual({first: 1, end: 4})
  expect(instantEventsNear(input, 1.2)).toEqual({first: 1, end: 3, time: 1.2})
  expect(instantEventsNear(input, 1.19, 0.02)?.first).toBe(1)
  expect(instantEventsNear(input, 1.1, 0.001)).toBeNull()
})

test('dense representatives are exact source points with bounded global-budget inputs and honest counts', () => {
  const input = row(Array.from({length: 12000}, (_, i) => i))
  const result = collectInstantGlyphs(input, {left: 0, width: 11999}, Infinity, NaN)
  expect(result.indices.length).toBeLessThanOrEqual(MAX_VISIBLE_INSTANT_GLYPHS)
  expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(12000)
  expect(result.omitted).toBe(12000 - result.indices.length)
  expect(result.indices[0]).toBe(0)
  const small = collectInstantGlyphs(input, {left: 5000, width: 1000}, 800, 7)
  expect(small.indices.length).toBeLessThanOrEqual(7)
  expect(small.total).toBe(1001)
  for (const index of small.indices) expect(input.instant.times[index]).toBeGreaterThanOrEqual(5000)
})

test('coincident and display-colliding points remain reachable in original ranges', () => {
  const input = row(Array(5000).fill(0))
  const glyphs = collectInstantGlyphs(input, {left: 0, width: 1}, 800)
  expect(Array.from(glyphs.indices)).toEqual([0])
  expect(Array.from(glyphs.counts)).toEqual([5000])
  expect(glyphs.omitted).toBe(4999)
  expect(instantEventRange(input, {left: 0, width: 0})).toEqual({first: 0, end: 5000})
  const collision = row([0, 0.1, 0.2], 1e20)
  expect(instantEventsNear(collision, 1e20)?.end).toBe(3)
  expect(collision.instant.times[1]).toBe(0.1)
})

test('marker-only and single-point layouts have safe extents and respect distinct clocks/units', () => {
  const input = row([0]).instant
  const layout = buildMultiTrackLayout(
    [],
    [],
    [
      input,
      {...input, id: 'second', clock: 'other'},
      {...input, id: 'third', timeUnit: 'milliseconds'},
    ],
  )
  expect(layout.groups).toHaveLength(3)
  expect(layout.groups[0].instantRows[0].instant.times).toBe(input.times)
  expect(layout.groups[0].span).toBe(0)
  expect(clampMultiTrackViewport(layout.groups[0], {left: 0, width: Infinity})).toEqual({
    left: 0,
    width: 1,
  })
  const empty = row([]).instant
  expect(buildMultiTrackLayout([], [], [empty]).excludedInstants).toHaveLength(1)
  expect(collectInstantGlyphs(row([0]), {left: 0, width: 1}, 800, 0).indices).toHaveLength(0)
})
