import {CounterTrack} from './counter-track'
import type {MultiTrackViewport} from './multi-track-layout'

export const MAX_VISIBLE_COUNTER_POINTS = 16384
export interface CounterTimelineRow {
  kind: 'counter'
  counter: CounterTrack
  counterIndex: number
  offset: number
}
export interface CounterEnvelope {
  start: number
  end: number
  minIndex: number
  maxIndex: number
}
export interface CounterPlot {
  indices: Uint32Array
  envelopes: CounterEnvelope[]
  min: number
  max: number
  decimated: boolean
  observations: number
}

function upperBound(times: Float64Array, value: number, offset = 0): number {
  let left = 0,
    right = times.length
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2)
    if (offset + times[middle] <= value) left = middle + 1
    else right = middle
  }
  return left
}

// The step value is known only between first and last observations. Equal-time
// samples have zero duration; the final observation at that timestamp wins.
export function counterObservationAt(row: CounterTimelineRow, time: number): number | null {
  const {times} = row.counter
  if (!times.length || time < row.offset + times[0] || time > row.offset + times[times.length - 1])
    return null
  const index = upperBound(times, time, row.offset) - 1
  return index < 0 ? null : index
}

export function counterValueFraction(value: number, min: number, max: number): number {
  if (max === min) return 0.5
  const span = max - min
  if (Number.isFinite(span)) return Math.max(0, Math.min(1, (value - min) / span))
  // Half-scale first so finite signed ranges near ±1e308 do not overflow.
  return Math.max(0, Math.min(1, (value / 2 - min / 2) / (max / 2 - min / 2)))
}

// Dense charts retain first/min/max/last actual observations in each time
// bucket. Render their original step segments independently, plus an explicitly
// labeled min/max envelope: reconnecting omitted points would lengthen spikes.
export async function collectCounterPlot(
  row: CounterTimelineRow,
  viewport: MultiTrackViewport,
  width: number,
  options: {signal?: AbortSignal; maxPoints?: number; yieldControl?: () => Promise<void>} = {},
): Promise<CounterPlot> {
  const result: CounterPlot = {
    indices: new Uint32Array(0),
    envelopes: [],
    min: 0,
    max: 0,
    decimated: false,
    observations: 0,
  }
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Counter rendering cancelled', 'AbortError')
  }
  checkAbort()
  const {times, values} = row.counter
  if (!times.length || !(viewport.width > 0) || !Number.isFinite(viewport.width)) return result
  const left = viewport.left,
    right = viewport.left + viewport.width
  if (
    !(right >= left) ||
    right < row.offset + times[0] ||
    left > row.offset + times[times.length - 1]
  )
    return result
  const cap = Number.isFinite(options.maxPoints)
    ? Math.max(4, Math.min(MAX_VISIBLE_COUNTER_POINTS, Math.floor(options.maxPoints!)))
    : MAX_VISIBLE_COUNTER_POINTS
  const count = Math.max(
    1,
    Math.min(1024, Math.floor(Number.isFinite(width) ? width : 1024), Math.floor(cap / 4)),
  )
  const buckets = new Int32Array(count * 4)
  buckets.fill(-1)
  let exact: number[] | null = []
  const first = Math.max(0, upperBound(times, left, row.offset) - 1)
  const last = Math.min(times.length - 1, upperBound(times, right, row.offset) - 1)
  let min = Infinity,
    max = -Infinity,
    lastYield = performance.now()
  for (let index = first; index <= last; index++) {
    if (index % 4096 === 0) {
      checkAbort()
      if (performance.now() - lastYield >= 8) {
        await (options.yieldControl
          ? options.yieldControl()
          : new Promise<void>(resolve => setTimeout(resolve, 0)))
        checkAbort()
        lastYield = performance.now()
      }
    }
    if (index + 1 < times.length && times[index + 1] === times[index]) continue
    const value = values[index]
    min = Math.min(min, value)
    max = Math.max(max, value)
    const bucket =
      Math.max(
        0,
        Math.min(
          count - 1,
          Math.floor(((Math.max(left, row.offset + times[index]) - left) / viewport.width) * count),
        ),
      ) * 4
    if (buckets[bucket] < 0) buckets[bucket] = buckets[bucket + 1] = buckets[bucket + 2] = index
    if (value < values[buckets[bucket + 1]]) buckets[bucket + 1] = index
    if (value > values[buckets[bucket + 2]]) buckets[bucket + 2] = index
    buckets[bucket + 3] = index
    if (exact) {
      if (exact.length < cap) exact.push(index)
      else exact = null
    }
    result.observations++
  }
  checkAbort()
  if (!result.observations) return result
  result.min = min
  result.max = max
  result.decimated = exact === null
  if (exact) result.indices = Uint32Array.from(exact)
  else {
    const selected: number[] = []
    for (let bucket = 0; bucket < count; bucket++) {
      const offset = bucket * 4
      if (buckets[offset] < 0) continue
      const indices = [
        buckets[offset],
        buckets[offset + 1],
        buckets[offset + 2],
        buckets[offset + 3],
      ].sort((a, b) => a - b)
      for (const index of indices) if (selected[selected.length - 1] !== index) selected.push(index)
      result.envelopes.push({
        start: Math.max(viewport.left + (bucket / count) * viewport.width, row.offset + times[0]),
        end: Math.min(
          viewport.left + ((bucket + 1) / count) * viewport.width,
          row.offset + times[times.length - 1],
        ),
        minIndex: buckets[offset + 1],
        maxIndex: buckets[offset + 2],
      })
    }
    result.indices = Uint32Array.from(selected)
  }
  return result
}
