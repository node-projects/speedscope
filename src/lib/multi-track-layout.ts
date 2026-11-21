import {CallTreeNode, Profile} from './profile'
import {FileFormat} from './file-format-spec'
import {axisTicks, niceTickInterval} from './axis-ticks'
import {TimeFormatter} from './value-formatters'
import {CounterTrack, COUNTER_LIMITS} from './counter-track'
import {CounterTimelineRow} from './counter-track-layout'
import {ProfileCallEventRangeIndex} from './profile-call-event-index'
import {InstantTrack, INSTANT_LIMITS} from './instant-track'
import {InstantTimelineRow} from './instant-track-layout'

export type TimelineUnit = Exclude<FileFormat.ValueUnit, 'none' | 'bytes'>
export interface TimelineTrack {
  profile: Profile
  profileIndex: number
  offset: number
}
export interface MultiTrackGroup {
  key: string
  clock: string
  unit: TimelineUnit
  referenceStart: number
  span: number
  tracks: TimelineTrack[]
  counterRows: CounterTimelineRow[]
  instantRows: InstantTimelineRow[]
  rows: (TimelineTrack | CounterTimelineRow | InstantTimelineRow)[]
}
export interface MultiTrackLayout {
  groups: MultiTrackGroup[]
  excluded: {profileIndex: number; reason: string}[]
  uninspectedCount: number
  excludedCounters: {counterIndex: number; reason: string}[]
  uninspectedCounterCount: number
  excludedInstants: {instantIndex: number; reason: string}[]
  uninspectedInstantCount: number
}
export interface MultiTrackViewport {
  left: number
  width: number
}
export const MULTI_TRACK_DEPTH = 8
export const MULTI_TRACK_MAX_TILES = 12000

export function multiTrackAxisTicks(
  viewport: MultiTrackViewport,
  width: number,
  unit: TimelineUnit,
) {
  const format = new TimeFormatter(unit)
  let interval = niceTickInterval(viewport.width / Math.max(1, width / 110), unit)
  let positions: number[] = []
  for (let attempt = 0; attempt < 32; attempt++) {
    positions = axisTicks(viewport.left, viewport.left + viewport.width, interval).positions.slice(
      0,
      100,
    )
    let labelWidth = 0
    for (const position of positions)
      labelWidth = Math.max(labelWidth, format.format(position, interval).length * 7 + 12)
    if (positions.length < 2 || (interval / viewport.width) * width >= labelWidth) break
    const next = niceTickInterval(interval * 2.5, unit)
    if (!Number.isFinite(next) || !(next > interval)) break
    interval = next
  }
  return {interval, positions}
}

export function buildMultiTrackLayout(
  profiles: readonly Profile[],
  counterTracks: readonly CounterTrack[] = [],
  instantTracks: readonly InstantTrack[] = [],
): MultiTrackLayout {
  const layout: MultiTrackLayout = {
    groups: [],
    excluded: [],
    uninspectedCount: Math.max(0, profiles.length - 10000),
    excludedCounters: [],
    uninspectedCounterCount: Math.max(0, counterTracks.length - COUNTER_LIMITS.tracks),
    excludedInstants: [],
    uninspectedInstantCount: Math.max(0, instantTracks.length - INSTANT_LIMITS.tracks),
  }
  const pending = new Map<
    string,
    {
      clock: string
      unit: TimelineUnit
      tracks: {profile: Profile; profileIndex: number; start: number}[]
      counters: {counter: CounterTrack; counterIndex: number; start: number}[]
      instants: {instant: InstantTrack; instantIndex: number; start: number}[]
    }
  >()
  for (let profileIndex = 0; profileIndex < Math.min(profiles.length, 10000); profileIndex++) {
    const profile = profiles[profileIndex]
    const origin = profile.getTimelineOrigin()
    const unit = profile.getWeightUnit()
    const reason =
      !profile.isChronological() || profile.isDerived()
        ? 'Aggregate or derived profile has no original time axis'
        : unit === 'none' || unit === 'bytes'
          ? 'Profile does not use time units'
          : !origin || !origin.clock || !Number.isFinite(origin.start)
            ? 'No explicit shared-clock timeline origin'
            : !Number.isFinite(profile.getTotalWeight()) || profile.getTotalWeight() < 0
              ? 'Invalid timeline duration'
              : null
    if (reason || !origin || unit === 'none' || unit === 'bytes') {
      layout.excluded.push({profileIndex, reason: reason || 'Unsupported timeline'})
      continue
    }
    const key = JSON.stringify([origin.clock, unit])
    let group = pending.get(key)
    if (!group) {
      group = {clock: origin.clock, unit, tracks: [], counters: [], instants: []}
      pending.set(key, group)
    }
    group.tracks.push({profile, profileIndex, start: origin.start})
  }
  for (
    let counterIndex = 0;
    counterIndex < Math.min(counterTracks.length, COUNTER_LIMITS.tracks);
    counterIndex++
  ) {
    const counter = counterTracks[counterIndex]
    if (
      !counter.times.length ||
      !Number.isFinite(counter.start) ||
      !Number.isFinite(counter.times[counter.times.length - 1])
    ) {
      layout.excludedCounters.push({
        counterIndex,
        reason: 'Counter has no finite observed time domain',
      })
      continue
    }
    const key = JSON.stringify([counter.clock, counter.timeUnit])
    let group = pending.get(key)
    if (!group) {
      group = {clock: counter.clock, unit: counter.timeUnit, tracks: [], counters: [], instants: []}
      pending.set(key, group)
    }
    group.counters.push({counter, counterIndex, start: counter.start})
  }
  for (
    let instantIndex = 0;
    instantIndex < Math.min(instantTracks.length, INSTANT_LIMITS.tracks);
    instantIndex++
  ) {
    const instant = instantTracks[instantIndex]
    if (
      !instant.times.length ||
      !Number.isFinite(instant.start) ||
      !Number.isFinite(instant.times[instant.times.length - 1])
    ) {
      layout.excludedInstants.push({
        instantIndex,
        reason: 'Instant lane has no finite observed time domain',
      })
      continue
    }
    const key = JSON.stringify([instant.clock, instant.timeUnit])
    let group = pending.get(key)
    if (!group) {
      group = {clock: instant.clock, unit: instant.timeUnit, tracks: [], counters: [], instants: []}
      pending.set(key, group)
    }
    group.instants.push({instant, instantIndex, start: instant.start})
  }
  for (const [key, group] of pending) {
    let referenceStart = Infinity
    for (const track of group.tracks) referenceStart = Math.min(referenceStart, track.start)
    for (const counter of group.counters) referenceStart = Math.min(referenceStart, counter.start)
    for (const instant of group.instants) referenceStart = Math.min(referenceStart, instant.start)
    const tracks: TimelineTrack[] = []
    let span = 0
    for (const {profile, profileIndex, start} of group.tracks) {
      const offset = start - referenceStart
      const end = offset + profile.getTotalWeight()
      if (!Number.isFinite(end)) {
        layout.excluded.push({profileIndex, reason: 'Shared-clock span exceeds numeric range'})
        continue
      }
      tracks.push({profile, profileIndex, offset})
      span = Math.max(span, end)
    }
    const counterRows: CounterTimelineRow[] = []
    for (const {counter, counterIndex, start} of group.counters) {
      const offset = start - referenceStart
      const end = offset + counter.times[counter.times.length - 1]
      if (!Number.isFinite(end)) {
        layout.excludedCounters.push({
          counterIndex,
          reason: 'Shared-clock counter span exceeds numeric range',
        })
        continue
      }
      counterRows.push({kind: 'counter', counter, counterIndex, offset})
      span = Math.max(span, end)
    }
    const instantRows: InstantTimelineRow[] = []
    for (const {instant, instantIndex, start} of group.instants) {
      const offset = start - referenceStart
      const end = offset + instant.times[instant.times.length - 1]
      if (!Number.isFinite(end)) {
        layout.excludedInstants.push({
          instantIndex,
          reason: 'Shared-clock instant span exceeds numeric range',
        })
        continue
      }
      instantRows.push({kind: 'instant', instant, instantIndex, offset})
      span = Math.max(span, end)
    }
    if (tracks.length || counterRows.length || instantRows.length)
      layout.groups.push({
        key,
        clock: group.clock,
        unit: group.unit,
        referenceStart,
        span,
        tracks,
        counterRows,
        instantRows,
        rows: [...tracks, ...counterRows, ...instantRows],
      })
  }
  return layout
}

export function clampMultiTrackViewport(
  group: MultiTrackGroup,
  viewport: MultiTrackViewport,
): MultiTrackViewport {
  const span = group.span > 0 ? group.span : 1
  const minimum = Math.min(
    span,
    Math.max(span / 1e9, Math.abs(group.referenceStart) * Number.EPSILON * 4, Number.MIN_VALUE),
  )
  const width = Number.isFinite(viewport.width)
    ? Math.min(span, Math.max(minimum, viewport.width))
    : span
  const left = Number.isFinite(viewport.left)
    ? Math.max(0, Math.min(span - width, viewport.left))
    : 0
  return {left, width}
}

export interface TimelineTile {
  node: CallTreeNode
  depth: number
  start: number
  end: number
}
export interface TrackTiles {
  tiles: TimelineTile[]
  omitted: number
  deeper: boolean
  eventsVisited: number
}

// Extract only a viewport's bounded geometry. Profile event iteration is reused;
// no second full flamechart, interval tree, stack strings or GPU batches persist.
// Optional range indices seek to a preceding bounded checkpoint; the default
// iterator scans its prefix. Both paths yield so pan/cancel stays usable.
export async function collectTrackTiles(
  track: TimelineTrack,
  viewport: MultiTrackViewport,
  options: {
    signal?: AbortSignal
    maxTiles?: number
    yieldControl?: () => Promise<void>
    rangeIndex?: ProfileCallEventRangeIndex
  } = {},
): Promise<TrackTiles> {
  const result: TrackTiles = {tiles: [], omitted: 0, deeper: false, eventsVisited: 0}
  const left = Math.max(0, viewport.left - track.offset)
  const right = Math.min(
    track.profile.getTotalWeight(),
    viewport.left + viewport.width - track.offset,
  )
  const checkAbort = () => {
    if (options.signal?.aborted)
      throw new DOMException('Timeline rendering cancelled', 'AbortError')
  }
  checkAbort()
  if (!(right > left)) return result
  const cap = Number.isFinite(options.maxTiles)
    ? Math.min(MULTI_TRACK_MAX_TILES, Math.max(0, Math.floor(options.maxTiles!)))
    : MULTI_TRACK_MAX_TILES
  const starts: {node: CallTreeNode; start: number}[] = []
  type RankedTile = TimelineTile & {rank: number}
  const heap: RankedTile[] = []
  let ordinal = 0
  const compare = (a: RankedTile, b: RankedTile) =>
    a.end - a.start - (b.end - b.start) || b.depth - a.depth || a.rank - b.rank
  // Spread equal-duration ties across the viewport rather than keeping only
  // its beginning. Tiles remain actual source intervals, never occupancy bins.
  const rank = (value: number) => {
    let hash = value | 0
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d)
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b)
    return (hash ^ (hash >>> 16)) >>> 0
  }
  let depth = 0,
    hiddenStart: number | null = null,
    lastYield = performance.now()
  const append = (node: CallTreeNode, level: number, start: number, end: number) => {
    if (end <= left || start >= right || !(end > start)) return
    const candidateStart = Math.max(left, start) + track.offset
    const candidateEnd = Math.min(right, end) + track.offset
    const candidateRank = rank(++ordinal)
    if (!cap) {
      result.omitted++
      return
    }
    if (heap.length >= cap) {
      result.omitted++
      const root = heap[0]
      const priority =
        candidateEnd - candidateStart - (root.end - root.start) ||
        root.depth - level ||
        candidateRank - root.rank
      if (priority <= 0) return
    }
    const tile: RankedTile = {
      node,
      depth: level,
      start: candidateStart,
      end: candidateEnd,
      rank: candidateRank,
    }
    if (heap.length < cap) {
      let index = heap.length
      heap.push(tile)
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2)
        if (compare(heap[parent], tile) <= 0) break
        heap[index] = heap[parent]
        index = parent
      }
      heap[index] = tile
    } else {
      let index = 0
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1
        if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++
        if (compare(tile, heap[child]) <= 0) break
        heap[index] = heap[child]
        index = child
      }
      heap[index] = tile
    }
  }
  const events =
    options.rangeIndex && left > 0
      ? options.rangeIndex.getCallEvents(left)
      : track.profile.getCallEvents()
  for (const event of events) {
    if (event.value >= right) break
    if (event.open) {
      if (depth < MULTI_TRACK_DEPTH) starts[depth] = {node: event.node, start: event.value}
      else if (depth === MULTI_TRACK_DEPTH) hiddenStart = event.value
      depth++
    } else {
      depth--
      if (depth < MULTI_TRACK_DEPTH) {
        const start = starts.pop()
        if (start) append(start.node, depth, start.start, event.value)
      } else if (depth === MULTI_TRACK_DEPTH && hiddenStart !== null) {
        if (event.value > Math.max(left, hiddenStart)) result.deeper = true
        hiddenStart = null
      }
    }
    result.eventsVisited++
    if (result.eventsVisited % 1024 === 0) {
      checkAbort()
      if (performance.now() - lastYield >= 8) {
        await (options.yieldControl
          ? options.yieldControl()
          : new Promise<void>(resolve => setTimeout(resolve, 0)))
        checkAbort()
        lastYield = performance.now()
      }
    }
  }
  if (depth > MULTI_TRACK_DEPTH && hiddenStart !== null && right > Math.max(left, hiddenStart))
    result.deeper = true
  for (let level = 0; level < starts.length; level++) {
    const start = starts[level]
    append(start.node, level, start.start, right)
  }
  checkAbort()
  result.tiles = heap.sort((a, b) => a.start - b.start || a.depth - b.depth || a.end - b.end)
  return result
}
