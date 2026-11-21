import type {CounterTimeUnit} from './counter-track'
import type {FileFormat} from './file-format-spec'

export interface InstantEventInfo {
  readonly name: string
  readonly category?: string
  readonly details?: string
}
export interface InstantEventOmission {
  readonly count: number
  readonly reason: 'point-limit' | 'track-limit' | 'metadata-limit' | 'details-limit'
}
export class InstantEventResourceLimitError extends Error {
  constructor(
    readonly reason: InstantEventOmission['reason'],
    message: string,
  ) {
    super(`Instant tracks: ${message}`)
    this.name = 'InstantEventResourceLimitError'
  }
}
export function validateInstantEventOmission(
  value: unknown,
): Readonly<InstantEventOmission> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid omission summary')
  const data = value as Record<string, unknown>
  const count = data.count,
    reason = data.reason
  if (
    !Object.prototype.hasOwnProperty.call(data, 'count') ||
    !Object.prototype.hasOwnProperty.call(data, 'reason') ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    typeof reason !== 'string' ||
    !['point-limit', 'track-limit', 'metadata-limit', 'details-limit'].includes(reason)
  )
    fail('invalid omission count or reason')
  return Object.freeze({count, reason: reason as InstantEventOmission['reason']})
}
export function validateInstantTrackOmissionState(
  tracks: readonly unknown[] | undefined,
  value: unknown,
) {
  const omission = validateInstantEventOmission(value)
  if (omission && tracks?.length) fail('omission summary cannot accompany retained instant tracks')
  return omission
}
export interface InstantTrack {
  readonly id: string
  readonly name: string
  readonly clock: string
  readonly timeUnit: CounterTimeUnit
  readonly start: number
  readonly scope: 'thread' | 'process' | 'global'
  readonly processId?: string
  readonly threadId?: string
  // Numeric storage is immutable by ownership convention; nonempty typed
  // arrays cannot be frozen. Metadata and its arrays are copied and frozen.
  readonly times: Float64Array
  readonly events: readonly InstantEventInfo[]
}
export const INSTANT_LIMITS = Object.freeze({
  tracks: 256,
  points: 250000,
  labelCharacters: 512,
  detailsCharacters: 16384,
  totalMetadataCharacters: 4194304,
  backingBytes: 250000 * 8,
})
export interface InstantHydrationOptions {
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}
function fail(message: string): never {
  throw new Error(`Instant tracks: ${message}`)
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
// Only arrays completed here can reuse their frozen event metadata during later
// validation/export. Weak branding does not retain old recordings.
const completed = new WeakSet<object>()
function backing(array: Float64Array): ArrayBuffer {
  try {
    arrayBufferLength.call(array.buffer)
    return array.buffer as ArrayBuffer
  } catch {
    return fail('timestamps require transferable ArrayBuffer storage')
  }
}
function prepare(input: unknown, native: boolean) {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) fail('invalid track list')
  if (input.length > INSTANT_LIMITS.tracks)
    throw new InstantEventResourceLimitError('track-limit', 'track limit exceeded')
  const ids = new Set<string>(),
    buffers = new Set<ArrayBuffer>()
  const tracks: (Omit<InstantTrack, 'events'> & {events: InstantEventInfo[]})[] = []
  const reuseMetadata = !native && completed.has(input)
  let points = 0,
    bytes = 0,
    characters = 0
  const text = (value: unknown, details = false, optional = false): string | undefined => {
    if (value === undefined && optional) return undefined
    if (typeof value !== 'string') fail('invalid event text')
    if (
      value.length > (details ? INSTANT_LIMITS.detailsCharacters : INSTANT_LIMITS.labelCharacters)
    )
      throw new InstantEventResourceLimitError(
        details ? 'details-limit' : 'metadata-limit',
        'oversized event text',
      )
    if (
      !details &&
      (!value.length || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value))
    )
      fail('invalid event label')
    characters += value.length
    if (characters > INSTANT_LIMITS.totalMetadataCharacters)
      throw new InstantEventResourceLimitError(
        'metadata-limit',
        'total event metadata limit exceeded',
      )
    return value
  }
  for (const item of input) {
    if (!item || typeof item !== 'object') fail('invalid instant track')
    const id = text(item.id)!,
      name = text(item.name)!,
      clock = text(item.clock)!
    if (ids.has(id)) fail('duplicate instant track identity')
    ids.add(id)
    if (
      !['nanoseconds', 'microseconds', 'milliseconds', 'seconds'].includes(item.timeUnit) ||
      typeof item.start !== 'number' ||
      !Number.isFinite(item.start)
    )
      fail('invalid instant clock unit or origin')
    if (!['thread', 'process', 'global'].includes(item.scope)) fail('invalid instant event scope')
    const processId = text(item.processId, false, true),
      threadId = text(item.threadId, false, true)
    if (
      native
        ? !Array.isArray(item.times)
        : !ArrayBuffer.isView(item.times) ||
          Object.prototype.toString.call(item.times) !== '[object Float64Array]'
    )
      fail('invalid instant timestamp array')
    if (!Array.isArray(item.events) || item.events.length !== item.times.length)
      fail('mismatched event arrays')
    if ((points += item.times.length) > INSTANT_LIMITS.points)
      throw new InstantEventResourceLimitError('point-limit', 'point limit exceeded')
    if (!native) {
      const buffer = backing(item.times)
      if (!buffers.has(buffer)) {
        buffers.add(buffer)
        bytes += arrayBufferLength.call(buffer)
        if (bytes > INSTANT_LIMITS.backingBytes)
          throw new InstantEventResourceLimitError(
            'point-limit',
            'timestamp backing storage limit exceeded',
          )
      }
    }
    tracks.push({
      id,
      name,
      clock,
      timeUnit: item.timeUnit,
      start: item.start,
      scope: item.scope,
      ...(processId === undefined ? {} : {processId}),
      ...(threadId === undefined ? {} : {threadId}),
      times: native ? new Float64Array(item.times.length) : item.times,
      events: reuseMetadata ? item.events : [],
    })
  }
  return {input, tracks, native, text, reuseMetadata}
}
function point(
  prepared: NonNullable<ReturnType<typeof prepare>>,
  trackIndex: number,
  index: number,
) {
  const source = prepared.input[trackIndex],
    target = prepared.tracks[trackIndex],
    time = source.times[index],
    info = source.events[index]
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    time < 0 ||
    (index && time < source.times[index - 1])
  )
    fail('timestamps must be finite nonnegative and sorted')
  if (!info || typeof info !== 'object' || Array.isArray(info))
    fail('invalid instant event metadata')
  const name = prepared.text(info.name)!,
    category = prepared.text(info.category, false, true),
    details = prepared.text(info.details, true, true)
  if (!prepared.reuseMetadata)
    target.events.push(
      Object.freeze({
        name,
        ...(category === undefined ? {} : {category}),
        ...(details === undefined ? {} : {details}),
      }),
    )
  if (prepared.native) target.times[index] = time
}
function finish(prepared: NonNullable<ReturnType<typeof prepare>>): readonly InstantTrack[] {
  const result = Object.freeze(
    prepared.tracks.map(track => Object.freeze({...track, events: Object.freeze(track.events)})),
  )
  completed.add(result)
  return result
}
export function importInstantTracks(
  input: FileFormat.InstantTrack[] | undefined,
): readonly InstantTrack[] | undefined {
  const prepared = prepare(input, true)
  if (!prepared) return undefined
  for (let track = 0; track < prepared.tracks.length; track++)
    for (let index = 0; index < prepared.tracks[track].times.length; index++)
      point(prepared, track, index)
  return finish(prepared)
}
export function validateInstantTracks(
  input: readonly InstantTrack[] | undefined,
): readonly InstantTrack[] | undefined {
  const prepared = prepare(input, false)
  if (!prepared) return undefined
  for (let track = 0; track < prepared.tracks.length; track++)
    for (let index = 0; index < prepared.tracks[track].times.length; index++)
      point(prepared, track, index)
  return finish(prepared)
}
export async function hydrateInstantTracks(
  input: readonly InstantTrack[] | undefined,
  options: InstantHydrationOptions = {},
): Promise<readonly InstantTrack[] | undefined> {
  abort(options.signal)
  const prepared = prepare(input, false)
  if (!prepared) return undefined
  let work = 0,
    lastYield = performance.now()
  for (let track = 0; track < prepared.tracks.length; track++)
    for (let index = 0; index < prepared.tracks[track].times.length; index++) {
      point(prepared, track, index)
      if ((++work & 1023) === 0) {
        abort(options.signal)
        if (options.yieldControl || performance.now() - lastYield >= 8) {
          await (options.yieldControl
            ? options.yieldControl()
            : new Promise(resolve => setTimeout(resolve, 0)))
          abort(options.signal)
          lastYield = performance.now()
        }
      }
    }
  abort(options.signal)
  return finish(prepared)
}
export function exportInstantTracks(
  input: readonly InstantTrack[] | undefined,
): FileFormat.InstantTrack[] | undefined {
  return validateInstantTracks(input)?.map(track => ({
    ...track,
    times: Array.from(track.times),
    events: track.events.map(info => ({...info})),
  }))
}
