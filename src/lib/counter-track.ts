import {FileFormat} from './file-format-spec'

export type CounterTimeUnit = 'nanoseconds' | 'microseconds' | 'milliseconds' | 'seconds'
// Arrays are immutable by convention once attached to a completed ProfileGroup.
// Worker transfer gives the receiving group ownership without duplicating data.
export interface CounterTrack {
  readonly id: string
  readonly name: string
  readonly clock: string
  readonly timeUnit: CounterTimeUnit
  readonly start: number
  readonly valueUnit: string
  readonly processId?: string
  readonly threadId?: string
  readonly category?: string
  readonly times: Float64Array
  readonly values: Float64Array
}
export const COUNTER_LIMITS = Object.freeze({
  tracks: 256,
  samples: 2000000,
  samplesPerTrack: 1000000,
  backingBytes: 2000000 * 16,
  labelCharacters: 512,
  totalLabelCharacters: 65536,
  clockCharacters: 128,
  unitCharacters: 64,
})
function fail(message: string): never {
  throw new Error(`Counter tracks: ${message}`)
}
export interface CounterHydrationOptions {
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
function isFloat64Array(value: unknown): value is Float64Array {
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Float64Array]'
  )
}
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
function transferable(array: Float64Array) {
  try {
    arrayBufferLength.call(array.buffer)
    return true
  } catch {
    return false
  }
}

function prepare(input: unknown, native: boolean) {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length > COUNTER_LIMITS.tracks)
    fail('series limit exceeded or invalid series list')
  const result: CounterTrack[] = []
  const ids = new Set<string>()
  const buffers = new Set<ArrayBuffer>()
  let backingBytes = 0
  let samples = 0,
    characters = 0
  const label = (value: unknown, maximum: number, required: boolean): string | undefined => {
    if (value === undefined && !required) return undefined
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > maximum ||
      value.trim() !== value ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      fail('invalid or oversized counter label')
    characters += (value as string).length
    if (characters > COUNTER_LIMITS.totalLabelCharacters) fail('total counter label limit exceeded')
    return value as string
  }
  for (const item of input) {
    if (!item || typeof item !== 'object') fail('invalid counter series')
    const id = label(item.id, COUNTER_LIMITS.labelCharacters, true)!
    if (ids.has(id)) fail('duplicate counter series identity')
    ids.add(id)
    const name = label(item.name, COUNTER_LIMITS.labelCharacters, true)!
    const clock = label(item.clock, COUNTER_LIMITS.clockCharacters, true)!
    const valueUnit = label(item.valueUnit, COUNTER_LIMITS.unitCharacters, true)!
    if (
      !['nanoseconds', 'microseconds', 'milliseconds', 'seconds'].includes(item.timeUnit) ||
      typeof item.start !== 'number' ||
      !Number.isFinite(item.start)
    )
      fail('invalid counter clock unit or origin')
    const processId = label(item.processId, COUNTER_LIMITS.labelCharacters, false)
    const threadId = label(item.threadId, COUNTER_LIMITS.labelCharacters, false)
    const category = label(item.category, COUNTER_LIMITS.labelCharacters, false)
    if (
      native
        ? !Array.isArray(item.times) || !Array.isArray(item.values)
        : !isFloat64Array(item.times) || !isFloat64Array(item.values)
    )
      fail('invalid counter numeric arrays')
    if (!native && (!transferable(item.times) || !transferable(item.values)))
      fail('counter arrays require transferable ArrayBuffer storage')
    if (!native) {
      for (const array of [item.times, item.values] as Float64Array[]) {
        const buffer = array.buffer as ArrayBuffer
        if (!buffers.has(buffer)) {
          buffers.add(buffer)
          backingBytes += arrayBufferLength.call(buffer)
          if (backingBytes > COUNTER_LIMITS.backingBytes)
            fail('counter backing storage limit exceeded')
        }
      }
    }
    if (
      item.times.length !== item.values.length ||
      item.times.length > COUNTER_LIMITS.samplesPerTrack ||
      (samples += item.times.length) > COUNTER_LIMITS.samples
    )
      fail('counter sample count limit or mismatched arrays')
    // Allocate only after all dimensions and label budgets have been checked.
    const times = native ? new Float64Array(item.times.length) : item.times
    const values = native ? new Float64Array(item.values.length) : item.values
    result.push({
      id,
      name,
      clock,
      timeUnit: item.timeUnit,
      start: item.start,
      valueUnit,
      ...(processId === undefined ? {} : {processId}),
      ...(threadId === undefined ? {} : {threadId}),
      ...(category === undefined ? {} : {category}),
      times,
      values,
    })
  }
  return {input, result, native}
}
function sample(
  prepared: NonNullable<ReturnType<typeof prepare>>,
  trackIndex: number,
  index: number,
) {
  const source = prepared.input[trackIndex],
    output = prepared.result[trackIndex]
  const time = source.times[index],
    value = source.values[index]
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    time < 0 ||
    (index && time < source.times[index - 1]) ||
    typeof value !== 'number' ||
    !Number.isFinite(value)
  )
    fail('samples require sorted finite nonnegative times and finite values')
  if (prepared.native) {
    output.times[index] = time
    output.values[index] = value
  }
}
// Native JSON already exists in memory. Convert once into bounded typed storage.
export function importCounterTracks(
  input: FileFormat.CounterTrack[] | undefined,
): readonly CounterTrack[] | undefined {
  const prepared = prepare(input, true)
  if (!prepared) return undefined
  for (let track = 0; track < prepared.result.length; track++)
    for (let at = 0; at < prepared.result[track].times.length; at++) sample(prepared, track, at)
  return prepared.result
}
// Main-thread model/export validation is synchronous and never duplicates arrays.
export function validateCounterTracks(
  input: readonly CounterTrack[] | undefined,
): readonly CounterTrack[] | undefined {
  const prepared = prepare(input, false)
  if (!prepared) return undefined
  for (let track = 0; track < prepared.result.length; track++)
    for (let at = 0; at < prepared.result[track].times.length; at++) sample(prepared, track, at)
  return prepared.result
}
// A transferred group is validated cooperatively before UI state takes ownership.
export async function hydrateCounterTracks(
  input: readonly CounterTrack[] | undefined,
  options: CounterHydrationOptions = {},
): Promise<readonly CounterTrack[] | undefined> {
  abort(options.signal)
  const prepared = prepare(input, false)
  if (!prepared) return undefined
  let work = 0,
    lastYield = performance.now()
  for (let track = 0; track < prepared.result.length; track++) {
    for (let at = 0; at < prepared.result[track].times.length; at++) {
      sample(prepared, track, at)
      if ((++work & 4095) === 0) {
        abort(options.signal)
        if (performance.now() - lastYield >= 8) {
          await (options.yieldControl
            ? options.yieldControl()
            : new Promise(resolve => setTimeout(resolve, 0)))
          abort(options.signal)
          lastYield = performance.now()
        }
      }
    }
  }
  abort(options.signal)
  return prepared.result
}

export function exportCounterTracks(
  input: readonly CounterTrack[] | undefined,
): FileFormat.CounterTrack[] | undefined {
  return validateCounterTracks(input)?.map(track => ({
    ...track,
    times: Array.from(track.times),
    values: Array.from(track.values),
  }))
}
