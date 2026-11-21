import {
  INSTANT_LIMITS,
  InstantEventInfo,
  InstantEventResourceLimitError,
  InstantEventOmission,
  InstantTrack,
  validateInstantTracks,
} from '../lib/instant-track'
import {ProfileGroup} from '../lib/profile'

export interface InstantTraceEvent {
  ph?: unknown
  ts?: unknown
  s?: unknown
  pid?: unknown
  tid?: unknown
  name?: unknown
  cat?: unknown
  args?: unknown
  stack?: unknown
  sf?: unknown
  id?: unknown
  id2?: unknown
  tts?: unknown
}

export const INSTANT_DETAILS_LIMITS = {depth: 8, nodes: 4096}

function resource(reason: InstantEventOmission['reason'], message: string): never {
  throw new InstantEventResourceLimitError(reason, `Trace instant: ${message}`)
}

function fail(message: string): never {
  throw new Error(`Trace instant: ${message}`)
}

// Legacy Chrome emits CpuProfile as phase I, whereas current Chrome uses P
// Profile/ProfileChunk records. They must reach the sampled-CPU importer first.
export function isChromeCPUProfileRecord(event: InstantTraceEvent): boolean {
  if (!event || typeof event !== 'object' || event.ph === 'C') return false
  if (
    event.ph === 'P' &&
    (event.name === 'Profile' || event.name === 'ProfileChunk' || event.name === 'CpuProfile')
  )
    return true
  if (event.name !== 'CpuProfile') return false
  const argsDescriptor = Object.getOwnPropertyDescriptor(event, 'args')
  if (!argsDescriptor || argsDescriptor.get || argsDescriptor.set) return false
  const args = argsDescriptor.value
  if (!args || typeof args !== 'object') return false
  const dataDescriptor = Object.getOwnPropertyDescriptor(args, 'data')
  if (!dataDescriptor || dataDescriptor.get || dataDescriptor.set) return false
  const data = dataDescriptor.value
  return (
    data != null &&
    typeof data === 'object' &&
    Object.prototype.hasOwnProperty.call(data, 'cpuProfile')
  )
}

export function isTraceInstant(event: InstantTraceEvent): boolean {
  if (event.ph !== 'i' && event.ph !== 'I' && event.ph !== 'R') return false
  return (
    !isChromeCPUProfileRecord(event) &&
    event.name !== 'JitCodeAdded' &&
    event.name !== 'JitCodeMoved'
  )
}

function label(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail(`${field} must be a nonempty trimmed label of at most 512 characters without controls`)
  if (value.length > INSTANT_LIMITS.labelCharacters)
    resource('metadata-limit', `${field} label exceeds 512 characters`)
  return value
}
function identity(value: unknown, field: string): unknown[] {
  if (value == null) return ['missing']
  if (typeof value === 'string') {
    if (value.length > INSTANT_LIMITS.labelCharacters)
      resource('metadata-limit', `${field} label exceeds 512 characters`)
    return ['string', value]
  }
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value]
  return fail(`${field} must be a finite number or string`)
}

// Validate exact JSON output size before serialization. No deep sanitized copy
// or unbounded stringify is created just to discover that details are too big.
function readDetailsFields(event: InstantTraceEvent): {[key: string]: unknown} {
  const details: {[key: string]: unknown} = {}
  for (const key of ['pid', 'tid', 'id', 'id2', 'args', 'stack', 'sf', 'tts'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(event, key)
    if (!descriptor) continue
    if (descriptor.get || descriptor.set) fail('event details cannot contain getters or setters')
    if (descriptor.value !== undefined) details[key] = descriptor.value
  }
  return details
}

function detailsForEvent(details: {[key: string]: unknown}): string | undefined {
  if (!Object.keys(details).length) return undefined
  let characters = 0,
    nodes = 0
  const ancestors = new Set<object>()
  const add = (count: number) => {
    characters += count
    if (characters > INSTANT_LIMITS.detailsCharacters)
      resource('details-limit', 'event details exceed 16,384 characters')
  }
  const string = (text: string) => {
    if (text.length > INSTANT_LIMITS.detailsCharacters)
      resource('details-limit', 'event details exceed 16,384 characters')
    add(2)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 34 || code === 92) add(2)
      else if (code <= 31) add([8, 9, 10, 12, 13].includes(code) ? 2 : 6)
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        add(2)
        i++
      } else if (code >= 0xd800 && code <= 0xdfff) add(6)
      else add(1)
    }
  }
  const visit = (value: unknown, depth: number) => {
    if (++nodes > INSTANT_DETAILS_LIMITS.nodes)
      resource('details-limit', 'event details exceed 4,096 nodes')
    if (depth > INSTANT_DETAILS_LIMITS.depth)
      resource('details-limit', 'event details exceed nesting depth 8')
    if (value === null) {
      add(4)
      return
    }
    if (typeof value === 'string') {
      string(value)
      return
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('event details contain a nonfinite number')
      add(String(value).length)
      return
    }
    if (typeof value === 'boolean') {
      add(value ? 4 : 5)
      return
    }
    if (!value || typeof value !== 'object') fail('event details must contain JSON values')
    const prototype = Object.getPrototypeOf(value)
    if (
      Array.isArray(value)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      fail('event details require plain JSON objects and arrays')
    if (ancestors.has(value)) fail('event details contain a cycle')
    const customJSON = Object.getOwnPropertyDescriptor(value, 'toJSON')
    if (customJSON && (customJSON.get || typeof customJSON.value === 'function'))
      fail('event details cannot contain a custom serializer')
    ancestors.add(value)
    add(2)
    let count = 0
    if (Array.isArray(value)) {
      if (value.length > INSTANT_DETAILS_LIMITS.nodes)
        resource('details-limit', 'event details exceed 4,096 nodes')
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
        if (!descriptor || descriptor.get) fail('event details require ordinary JSON array values')
        if (count++) add(1)
        visit(descriptor.value, depth + 1)
      }
    } else {
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (descriptor.get) fail('event details cannot contain getters')
        if (count++) add(1)
        string(key)
        add(1)
        visit(descriptor.value, depth + 1)
      }
    }
    ancestors.delete(value)
  }
  visit(details, 0)
  return JSON.stringify(details)
}

export function importTraceInstantTracks(
  events: readonly InstantTraceEvent[],
  clock = 'trace-event:wall',
): readonly InstantTrack[] {
  type Point = InstantEventInfo & {timestamp: number}
  type Lane = {track: Omit<InstantTrack, 'events'>; points: Point[]}
  const lanes = new Map<string, Lane>()
  let points = 0,
    metadata = 0
  const countMetadata = (count: number) => {
    metadata += count
    if (metadata > INSTANT_LIMITS.totalMetadataCharacters)
      resource('metadata-limit', 'event metadata exceeds 4,194,304 characters')
  }
  label(clock, 'clock')
  for (const event of events) {
    if (!isTraceInstant(event)) continue
    if (typeof event.ts !== 'number' || !Number.isFinite(event.ts))
      fail('timestamp must be a finite number of microseconds')
    const scope =
      event.s === undefined || event.s === 't'
        ? 'thread'
        : event.s === 'p'
          ? 'process'
          : event.s === 'g'
            ? 'global'
            : fail('scope must be t, p, or g')
    const fields = readDetailsFields(event)
    const pid = identity(fields.pid, 'pid'),
      tid = identity(fields.tid, 'tid')
    const key = JSON.stringify([
      scope,
      ...(scope === 'global' ? [] : scope === 'process' ? [pid] : [pid, tid]),
    ])
    const name = label(event.name, 'name')
    const category =
      event.cat == null || event.cat === '' ? undefined : label(event.cat, 'category')
    if (++points > INSTANT_LIMITS.points)
      resource('point-limit', 'more than 250,000 instant points')
    let lane = lanes.get(key)
    if (!lane) {
      if (lanes.size >= INSTANT_LIMITS.tracks)
        resource('track-limit', 'more than 256 instant lanes')
      const processId =
        scope !== 'global' && fields.pid != null && fields.pid !== ''
          ? label(String(fields.pid), 'pid')
          : undefined
      const threadId =
        scope === 'thread' && fields.tid != null && fields.tid !== ''
          ? label(String(fields.tid), 'tid')
          : undefined
      const track: Lane['track'] = {
        id: `trace-instant:${lanes.size}`,
        name: `${scope[0].toUpperCase()}${scope.slice(1)} instant events`,
        clock,
        timeUnit: 'microseconds',
        start: event.ts,
        scope,
        ...(processId ? {processId} : {}),
        ...(threadId ? {threadId} : {}),
        times: new Float64Array(0),
      }
      countMetadata(
        track.id.length +
          track.name.length +
          clock.length +
          (processId?.length || 0) +
          (threadId?.length || 0),
      )
      lane = {track, points: []}
      lanes.set(key, lane)
    }
    const details = detailsForEvent(fields)
    countMetadata(name.length + (category?.length || 0) + (details?.length || 0))
    lane.points.push({
      timestamp: event.ts,
      name,
      ...(category ? {category} : {}),
      ...(details === undefined ? {} : {details}),
    })
  }
  const tracks: InstantTrack[] = []
  for (const lane of lanes.values()) {
    lane.points.sort((a, b) => a.timestamp - b.timestamp)
    const start = lane.points[0].timestamp
    const times = new Float64Array(lane.points.length)
    for (let i = 0; i < times.length; i++) {
      const time = lane.points[i].timestamp - start
      if (!Number.isFinite(time)) fail('timestamp range overflows')
      times[i] = time
    }
    tracks.push({...lane.track, start, times, events: lane.points})
  }
  return validateInstantTracks(tracks) || []
}

// Mixed captures keep their existing stacks/counters when optional marker data
// exceeds a resource budget. All markers are omitted together and the explicit
// summary travels with the recording. Omitted marker data is not fully validated.
export function attachTraceInstantTracks(
  group: ProfileGroup,
  events: readonly InstantTraceEvent[],
  clock = 'trace-event:wall',
): ProfileGroup {
  const mixed = group.profiles.length > 0 || !!group.counterTracks?.length
  let count = 0
  if (mixed) {
    for (const event of events) if (isTraceInstant(event)) count++
    if (!count) return group
    if (count > INSTANT_LIMITS.points) {
      delete group.instantTracks
      group.instantEventOmission = Object.freeze({count, reason: 'point-limit'})
      return group
    }
  }
  try {
    const tracks = importTraceInstantTracks(events, clock)
    if (tracks.length) group.instantTracks = tracks
  } catch (error) {
    if (!mixed || !(error instanceof InstantEventResourceLimitError)) throw error
    delete group.instantTracks
    group.instantEventOmission = Object.freeze({count, reason: error.reason})
  }
  return group
}
