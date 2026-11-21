import {InstantTrack} from './instant-track'
import type {MultiTrackViewport} from './multi-track-layout'

export const MAX_VISIBLE_INSTANT_GLYPHS = 4096
export interface InstantTimelineRow {
  kind: 'instant'
  instant: InstantTrack
  instantIndex: number
  offset: number
}
export interface InstantEventRange {
  first: number
  end: number
}
export interface InstantGlyphs {
  indices: Uint32Array
  counts: Uint32Array
  total: number
  omitted: number
}

function bound(row: InstantTimelineRow, time: number, inclusive: boolean): number {
  let left = 0,
    right = row.instant.times.length
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2)
    const value = row.offset + row.instant.times[middle]
    if (value < time || (inclusive && value === time)) left = middle + 1
    else right = middle
  }
  return left
}

// Inclusive viewport endpoints retain every original coincident point. Search
// shared coordinates directly, avoiding fractional offset subtraction errors.
export function instantEventRange(
  row: InstantTimelineRow,
  viewport: MultiTrackViewport,
): InstantEventRange {
  if (!Number.isFinite(viewport.left) || !Number.isFinite(viewport.width) || viewport.width < 0)
    return {first: 0, end: 0}
  return {
    first: bound(row, viewport.left, false),
    end: bound(row, viewport.left + viewport.width, true),
  }
}

export function instantEventsNear(
  row: InstantTimelineRow,
  time: number,
  tolerance = 0,
): (InstantEventRange & {time: number}) | null {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !row.instant.times.length
  )
    return null
  const next = bound(row, time, false)
  let index = Math.min(next, row.instant.times.length - 1)
  if (
    next > 0 &&
    Math.abs(row.offset + row.instant.times[next - 1] - time) <=
      Math.abs(row.offset + row.instant.times[index] - time)
  )
    index = next - 1
  const observed = row.offset + row.instant.times[index]
  if (Math.abs(observed - time) > tolerance) return null
  return {time: observed, first: bound(row, observed, false), end: bound(row, observed, true)}
}

// One representative stays at its actual source timestamp per time bucket.
// Counts describe all represented points, not a fabricated duration or a claim
// that all bucketed points coincide. The inspector reads original ranges.
export function collectInstantGlyphs(
  row: InstantTimelineRow,
  viewport: MultiTrackViewport,
  width: number,
  maxGlyphs = MAX_VISIBLE_INSTANT_GLYPHS,
): InstantGlyphs {
  const range = instantEventRange(row, viewport)
  const total = range.end - range.first
  const cap = Number.isFinite(maxGlyphs)
    ? Math.min(MAX_VISIBLE_INSTANT_GLYPHS, Math.max(0, Math.floor(maxGlyphs)))
    : MAX_VISIBLE_INSTANT_GLYPHS
  const count = Math.min(cap, Math.max(1, Math.floor(Number.isFinite(width) ? width : cap)))
  if (!total || !count)
    return {indices: new Uint32Array(0), counts: new Uint32Array(0), total, omitted: total}
  const indices: number[] = [],
    counts: number[] = []
  let first = range.first
  for (let bucket = 0; bucket < count; bucket++) {
    const end =
      bucket + 1 === count
        ? range.end
        : bound(row, viewport.left + viewport.width * ((bucket + 1) / count), false)
    if (end > first) {
      indices.push(first)
      counts.push(end - first)
    }
    first = end
  }
  return {
    indices: Uint32Array.from(indices),
    counts: Uint32Array.from(counts),
    total,
    omitted: total - indices.length,
  }
}
