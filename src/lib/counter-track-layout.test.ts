import {CounterTrack} from './counter-track'
import {
  collectCounterPlot,
  counterObservationAt,
  counterValueFraction,
  CounterTimelineRow,
  MAX_VISIBLE_COUNTER_POINTS,
} from './counter-track-layout'
import {buildMultiTrackLayout} from './multi-track-layout'

function row(times: number[], values: number[], offset = 0): CounterTimelineRow {
  return {
    kind: 'counter',
    counterIndex: 0,
    offset,
    counter: {
      id: 'heap',
      name: 'Heap',
      clock: 'wall',
      start: 100,
      timeUnit: 'microseconds',
      valueUnit: 'bytes',
      times: Float64Array.from(times),
      values: Float64Array.from(values),
    },
  }
}

test('step lookup keeps the final equal-time observation without extrapolating either endpoint', () => {
  const input = row([0, 1, 1, 2, 3], [10, 500, 20, -5, 30], 7)
  expect(counterObservationAt(input, 6)).toBeNull()
  expect(counterObservationAt(input, 7)).toBe(0)
  expect(counterObservationAt(input, 8)).toBe(2)
  expect(counterObservationAt(input, 8.5)).toBe(2)
  expect(counterObservationAt(input, 10)).toBe(4)
  expect(counterObservationAt(input, 10.001)).toBeNull()
})

test('fractional observations use displayed shared coordinates at exact marker and viewport boundaries', async () => {
  const input = row([0, 0.2, 0.4], [100, 0, 200], 1)
  // (1.2 - 1) rounds below0.2; subtracting beforesearch wouldpickindex0.
  expect(counterObservationAt(input, 1.2)).toBe(1)
  expect(counterObservationAt(input, 1.4)).toBe(2)
  const plot = await collectCounterPlot(input, {left: 1.2, width: 0.2}, 800)
  expect(Array.from(plot.indices)).toEqual([1, 2])
  expect(plot.min).toBe(0)
  expect(plot.max).toBe(200)
})

test('counter-only layouts preserve explicit time clocks and independent value units without cloning arrays', () => {
  const input = row([0, 10], [1, 9]).counter
  const other: CounterTrack = {...input, id: 'gauge', name: 'Queue', start: 105, valueUnit: 'count'}
  const layout = buildMultiTrackLayout(
    [],
    [input, other, {...input, id: 'other-clock', clock: 'cpu'}],
  )
  expect(layout.groups).toHaveLength(2)
  expect(layout.groups[0].tracks).toHaveLength(0)
  expect(layout.groups[0].rows).toHaveLength(2)
  expect(layout.groups[0].span).toBe(15)
  expect(layout.groups[0].counterRows[1].offset).toBe(5)
  expect(layout.groups[0].counterRows[0].counter.times).toBe(input.times)
  expect(layout.groups[0].counterRows[1].counter.valueUnit).toBe('count')
  expect(
    buildMultiTrackLayout([], [{...input, times: new Float64Array(), values: new Float64Array()}])
      .excludedCounters,
  ).toHaveLength(1)
})

test('viewport extraction carries the previous observation only inside the observed domain', async () => {
  const input = row([0, 10, 20], [1, 9, 2], 5)
  const between = await collectCounterPlot(input, {left: 7, width: 3}, 800)
  expect(Array.from(between.indices)).toEqual([0])
  expect(between.min).toBe(1)
  expect(between.max).toBe(1)
  expect((await collectCounterPlot(input, {left: 26, width: 10}, 800)).indices).toHaveLength(0)
  expect((await collectCounterPlot(input, {left: 0, width: 4}, 800)).indices).toHaveLength(0)
})

test('dense min/max retention preserves narrow positive and negative spikes within a hard point budget', async () => {
  const times = Array.from({length: 20000}, (_, i) => i)
  const values = times.map(() => 3)
  values[1234] = 1000000
  values[17890] = -500
  const input = row(times, values)
  const plot = await collectCounterPlot(input, {left: 0, width: 19999}, 800, {maxPoints: 8})
  expect(plot.decimated).toBe(true)
  expect(plot.indices.length).toBeLessThanOrEqual(8)
  expect(Array.from(plot.indices)).toEqual(expect.arrayContaining([1234, 17890, 0, 19999]))
  expect(plot.min).toBe(-500)
  expect(plot.max).toBe(1000000)
  expect(plot.envelopes).toHaveLength(2)
  expect(plot.envelopes.some(bucket => bucket.maxIndex === 1234)).toBe(true)
  const guarded = await collectCounterPlot(input, {left: 0, width: 19999}, Infinity, {
    maxPoints: NaN,
  })
  expect(guarded.indices.length).toBeLessThanOrEqual(MAX_VISIBLE_COUNTER_POINTS)
})

test('superseded equal-time samples cannot invent zero-duration spikes', async () => {
  const plot = await collectCounterPlot(
    row([0, 1, 1, 2], [0, 1000000, 5, 0]),
    {left: 0, width: 2},
    800,
  )
  expect(Array.from(plot.indices)).toEqual([0, 2, 3])
  expect(plot.max).toBe(5)
})

test('signed huge and subnormal value ranges map without overflowing', () => {
  expect(counterValueFraction(-1e308, -1e308, 1e308)).toBe(0)
  expect(counterValueFraction(0, -1e308, 1e308)).toBe(0.5)
  expect(counterValueFraction(1e308, -1e308, 1e308)).toBe(1)
  expect(counterValueFraction(Number.MIN_VALUE, 0, Number.MIN_VALUE)).toBe(1)
  expect(counterValueFraction(2, 2, 2)).toBe(0.5)
})

test('long counter scans yield and abort without retaining a full point copy', async () => {
  const input = row(
    Array.from({length: 100000}, (_, i) => i),
    Array(100000).fill(3),
  )
  const controller = new AbortController()
  let now = 0
  jest.spyOn(performance, 'now').mockImplementation(() => (now += 9))
  const pause = jest.fn(async () => {
    controller.abort()
  })
  try {
    await expect(
      collectCounterPlot(input, {left: 0, width: 99999}, 800, {
        signal: controller.signal,
        yieldControl: pause,
      }),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(pause).toHaveBeenCalledTimes(1)
  } finally {
    jest.restoreAllMocks()
  }
})
