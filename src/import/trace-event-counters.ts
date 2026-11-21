import {CounterTrack, COUNTER_LIMITS, validateCounterTracks} from '../lib/counter-track'

export const TRACE_COUNTER_LIMITS = {
  tracks: COUNTER_LIMITS.tracks,
  points: COUNTER_LIMITS.samples,
  pointsPerTrack: COUNTER_LIMITS.samplesPerTrack,
  labelCharacters: COUNTER_LIMITS.labelCharacters,
  metadataCharacters: COUNTER_LIMITS.totalLabelCharacters,
}

export interface CounterTraceEvent {
  ph: string
  ts?: unknown
  pid?: unknown
  tid?: unknown
  id?: unknown
  id2?: unknown
  cat?: unknown
  name?: unknown
  args?: unknown
}

function fail(message: string): never {
  throw new Error(`Trace counter: ${message}`)
}
function label(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > TRACE_COUNTER_LIMITS.labelCharacters) {
    fail(`${field} must be a string of at most 512 characters`)
  }
  return value
}

function identity(value: unknown, field: string): [string, string | number] | ['missing'] {
  if (value === undefined) return ['missing']
  if (typeof value === 'string') return ['string', label(value, field)]
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value]
  return fail(`${field} must be a finite number or string`)
}

export function importTraceCounterTracks(
  events: readonly CounterTraceEvent[],
  clock = 'trace-event:wall',
): readonly CounterTrack[] {
  const tracks = new Map<
    string,
    {track: CounterTrack; argument: string; events: CounterTraceEvent[]}
  >()
  let points = 0
  let metadata = 0
  for (const event of events) {
    if (event.ph !== 'C') continue
    if (typeof event.ts !== 'number' || !Number.isFinite(event.ts))
      fail('timestamp must be a finite number of microseconds')
    if (event.id2 !== undefined) fail('id2 counter identities are not supported')
    const name = label(event.name, 'name')
    const category = event.cat === undefined ? '' : label(event.cat, 'category')
    const pid = identity(event.pid, 'pid')
    const tid = identity(event.tid, 'tid')
    const id = identity(event.id, 'id')
    if (!event.args || typeof event.args !== 'object' || Array.isArray(event.args))
      fail('args must be a nonempty object of numeric observations')
    let argumentsSeen = false
    for (const rawKey in event.args) {
      if (!Object.prototype.hasOwnProperty.call(event.args, rawKey)) continue
      argumentsSeen = true
      const argument = label(rawKey, 'argument key')
      const value = (event.args as {[key: string]: unknown})[argument]
      if (typeof value !== 'number' || !Number.isFinite(value))
        fail(`${name}.${argument} must be a finite number`)
      if (++points > TRACE_COUNTER_LIMITS.points) fail('more than 2,000,000 observations')
      const key = JSON.stringify([pid, tid, id, category, name, argument])
      let entry = tracks.get(key)
      if (!entry) {
        if (tracks.size >= TRACE_COUNTER_LIMITS.tracks) fail('more than 256 counter series')
        const suffix = event.id === undefined ? '' : ` [${JSON.stringify(event.id)}]`
        const displayName = label(`${name}${suffix} / ${argument}`, 'series name')
        const track: CounterTrack = {
          id: `trace-counter:${tracks.size}`,
          name: displayName,
          clock,
          timeUnit: 'microseconds',
          valueUnit: 'unknown',
          start: event.ts,
          times: new Float64Array(0),
          values: new Float64Array(0),
          ...(event.pid !== undefined && String(event.pid) ? {processId: String(event.pid)} : {}),
          ...(event.tid !== undefined && String(event.tid) ? {threadId: String(event.tid)} : {}),
          ...(category ? {category} : {}),
        }
        metadata +=
          track.id.length +
          displayName.length +
          clock.length +
          track.valueUnit.length +
          (track.processId?.length || 0) +
          (track.threadId?.length || 0) +
          category.length
        if (metadata > TRACE_COUNTER_LIMITS.metadataCharacters) fail('metadata exceeds 64 KiB')
        entry = {track, argument, events: []}
        tracks.set(key, entry)
      }
      if (entry.events.length >= TRACE_COUNTER_LIMITS.pointsPerTrack)
        fail('more than 1,000,000 observations in one series')
      entry.events.push(event)
    }
    if (!argumentsSeen) fail('args must contain at least one numeric observation')
  }
  // Validate the exact shared-model metadata policy while arrays are still
  // empty, before allocating point buffers or copying any observations.
  validateCounterTracks(Array.from(tracks.values(), entry => entry.track))
  const result: CounterTrack[] = []
  for (const entry of tracks.values()) {
    entry.events.sort((a, b) => (a.ts as number) - (b.ts as number))
    const start = entry.events[0].ts as number
    let unique = 0
    let previous: number | undefined
    for (const event of entry.events) {
      if (event.ts !== previous) unique++
      previous = event.ts as number
    }
    const times = new Float64Array(unique)
    const values = new Float64Array(unique)
    let index = -1
    previous = undefined
    for (const event of entry.events) {
      const timestamp = event.ts as number
      if (timestamp !== previous) {
        index++
        const elapsed = timestamp - start
        if (!Number.isFinite(elapsed)) fail('timestamp range overflows')
        times[index] = elapsed
      }
      values[index] = (event.args as {[key: string]: number})[entry.argument]
      previous = timestamp
    }
    result.push({...entry.track, start, times, values})
  }
  return validateCounterTracks(result) || []
}
