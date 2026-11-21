import {FrameInfo, ProfileGroup, StackListProfileBuilder} from '../lib/profile'
import {TimeFormatter} from '../lib/value-formatters'
import {ImportProgress} from './trace-worker-protocol'

// Restricted data-only reader based on CPython v3.14.3 Python/marshal.c and
// Lib/cProfile.py snapshot_stats. Never invokes Python or accepts code objects.
export const CPROFILE_LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  objects: 1000000,
  references: 500000,
  stringBytes: 8 * 1024 * 1024,
  singleStringBytes: 65536,
  depth: 16,
  functions: 100000,
  edges: 200000,
})
export interface CProfileOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImportProgress) => void
}
interface Tuple {
  kind: 'tuple'
  values: Value[]
}
interface Dict {
  kind: 'dict'
  entries: [Value, Value][]
}
type Value = number | string | Tuple | Dict
const fail = (reason: string): never => {
  throw new Error(`Python cProfile: ${reason}`)
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
export function isPythonCProfileFileName(name: string) {
  return /\.(?:prof|pstats|cprofile)$/i.test(name)
}
export function isPythonCProfile(buffer: ArrayBuffer, name: string) {
  if (!isPythonCProfileFileName(name) || buffer.byteLength < 2) return false
  const bytes = new Uint8Array(buffer)
  if ((bytes[0] & 127) !== 123) return false
  // A marshal dictionary and first three-field tuple key, not JSON's '{'.
  if (bytes[1] === 48) return true // Empty native dictionary: reject with a specific error.
  const tupleType = bytes[1] & 127
  return tupleType === 41
    ? bytes.length >= 3 && bytes[2] === 3
    : tupleType === 40 && bytes.length >= 6 && new DataView(buffer).getInt32(2, true) === 3
}
export async function checkPythonCProfileFileSize(file: File, signal?: AbortSignal) {
  abort(signal)
  if (file.size <= CPROFILE_LIMITS.bytes || !isPythonCProfileFileName(file.name)) return
  const header = await file.slice(0, 6).arrayBuffer()
  abort(signal)
  if (isPythonCProfile(header, file.name)) fail('input exceeds 32 MiB limit')
}

class Reader {
  private position = 0
  private objects = 0
  private textBytes = 0
  private references: (Value | null)[] = []
  private active = new Set<Value>()
  private view: DataView
  private bytes: Uint8Array
  private work = 0
  private lastYield = performance.now()
  constructor(
    buffer: ArrayBuffer,
    private options: CProfileOptions,
  ) {
    if (buffer.byteLength > CPROFILE_LIMITS.bytes) fail('input exceeds 32 MiB limit')
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }
  async checkpoint() {
    abort(this.options.signal)
    if ((++this.work & 1023) === 0 && performance.now() - this.lastYield >= 8) {
      this.options.onProgress?.({phase: 'Parsing profile', canCancel: true})
      await new Promise(resolve => setTimeout(resolve, 0))
      this.lastYield = performance.now()
      abort(this.options.signal)
    }
  }
  private take(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.bytes.length - this.position)
      fail('truncated or invalid marshal length')
    const start = this.position
    this.position += size
    return start
  }
  private byte() {
    return this.bytes[this.take(1)]
  }
  private int() {
    return this.view.getInt32(this.take(4), true)
  }
  private text(size: number, ascii: boolean) {
    if (
      size > CPROFILE_LIMITS.singleStringBytes ||
      (this.textBytes += size) > CPROFILE_LIMITS.stringBytes
    )
      fail('marshal string limit exceeded')
    const start = this.take(size),
      bytes = this.bytes.subarray(start, start + size)
    if (ascii && bytes.some(value => value > 127)) fail('invalid marshal ASCII string')
    try {
      return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    } catch {
      return fail('invalid UTF-8 source label')
    }
  }
  private async read(depth: number): Promise<Value> {
    await this.checkpoint()
    if (depth > CPROFILE_LIMITS.depth || ++this.objects > CPROFILE_LIMITS.objects)
      fail('marshal object/depth limit exceeded')
    const tag = this.byte(),
      type = tag & 127
    if (type === 114) {
      if (tag & 128) fail('reference cannot carry reference flag')
      const index = this.int(),
        value = this.references[index]
      if (index < 0 || value == null || this.active.has(value))
        fail('invalid or cyclic marshal reference')
      return value as Value
    }
    let ref = -1
    if (tag & 128) {
      if (this.references.length >= CPROFILE_LIMITS.references)
        fail('marshal reference limit exceeded')
      ref = this.references.length
      this.references.push(null)
    }
    let result: Value
    switch (type) {
      case 105:
        result = this.int()
        break // INT
      case 108: {
        // LONG: signed count, little-endian base 2^15 digits.
        const count = this.int(),
          digits = Math.abs(count)
        if (digits > 4) fail('integer exceeds exact JavaScript range')
        let value = 0,
          place = 1
        for (let i = 0; i < digits; i++) {
          const digit = this.view.getUint16(this.take(2), true)
          if (digit >= 32768) fail('invalid marshal long digit')
          value += digit * place
          place *= 32768
        }
        if (!Number.isSafeInteger(value)) fail('integer exceeds exact JavaScript range')
        result = count < 0 ? -value : value
        break
      }
      case 103:
        result = this.view.getFloat64(this.take(8), true)
        break
      case 102: {
        // Version 0 textual float, strict finite decimal grammar.
        const text = this.text(this.byte(), true)
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
          fail('invalid marshal float')
        result = Number(text)
        break
      }
      case 117:
      case 116:
        result = this.text(this.int(), false)
        break // UNICODE
      case 97:
      case 65:
        result = this.text(this.int(), true)
        break
      case 122:
      case 90:
        result = this.text(this.byte(), true)
        break
      case 40:
      case 41: {
        const size = type === 41 ? this.byte() : this.int()
        if (size < 0 || size > 5) fail('unsupported marshal tuple shape')
        const container: Tuple = {kind: 'tuple', values: []}
        if (ref >= 0) this.references[ref] = container
        this.active.add(container)
        for (let i = 0; i < size; i++) container.values.push(await this.read(depth + 1))
        this.active.delete(container)
        result = container
        break
      }
      case 123: {
        const dict: Dict = {kind: 'dict', entries: []}
        if (ref >= 0) this.references[ref] = dict
        this.active.add(dict)
        while (true) {
          if (this.bytes[this.position] === 48) {
            this.position++
            break
          }
          if (dict.entries.length >= CPROFILE_LIMITS.edges)
            fail('marshal dictionary limit exceeded')
          const key = await this.read(depth + 1),
            value = await this.read(depth + 1)
          dict.entries.push([key, value])
        }
        this.active.delete(dict)
        result = dict
        break
      }
      default:
        return fail(`unsupported marshal type 0x${type.toString(16)} (data-only cProfile required)`)
    }
    if (ref >= 0) this.references[ref] = result
    return result
  }
  async decode() {
    const result = await this.read(0)
    if (this.position !== this.bytes.length) fail('trailing bytes after marshal dictionary')
    return result
  }
}

function tuple(value: Value, size: number): Value[] {
  if (typeof value !== 'object' || value.kind !== 'tuple' || value.values.length !== size)
    fail('invalid cProfile tuple shape')
  return (value as Tuple).values
}
function dictionary(value: Value): [Value, Value][] {
  if (typeof value !== 'object' || value.kind !== 'dict') fail('expected cProfile dictionary')
  return (value as Dict).entries
}
function nonnegative(value: Value, integer: boolean): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  )
    fail('counts/times must be finite, nonnegative and counts exact integers')
  return value as number
}
function sourceLabel(value: Value): Omit<FrameInfo, 'key'> {
  const [file, line, name] = tuple(value, 3)
  if (typeof file !== 'string' || typeof name !== 'string') fail('invalid function source label')
  nonnegative(line, true)
  return {
    name: name as string,
    file: file === '~' ? undefined : (file as string),
    line: line ? (line as number) : undefined,
  }
}
function add(a: number, b: number) {
  const total = a + b
  if (!Number.isFinite(total)) fail('aggregate time overflow')
  return total
}

export async function importFromPythonCProfile(
  buffer: ArrayBuffer,
  fileName: string,
  options: CProfileOptions = {},
): Promise<ProfileGroup> {
  abort(options.signal)
  const reader = new Reader(buffer, options)
  const records = dictionary(await reader.decode())
  if (!records.length || records.length > CPROFILE_LIMITS.functions)
    fail('empty profile or function limit exceeded')
  const flat = new StackListProfileBuilder(),
    attributed = new StackListProfileBuilder()
  flat.setValueFormatter(new TimeFormatter('seconds'))
  attributed.setValueFormatter(new TimeFormatter('seconds'))
  const seen = new Set<string | number>()
  // Shared marshal strings/tuples must not expand into huge repeated JSON keys.
  // Intern by individual source fields; each output frame uses a small numeric key.
  const labels = new Map<string, Map<number, Map<string, FrameInfo>>>()
  const tupleLabels = new WeakMap<object, FrameInfo>()
  let nextFrameKey = 0
  const label = (value: Value): FrameInfo => {
    if (typeof value === 'object') {
      const cached = tupleLabels.get(value)
      if (cached) return cached
    }
    const info = sourceLabel(value)
    const file = info.file ?? '~',
      line = info.line ?? 0
    let lines = labels.get(file)
    if (!lines) labels.set(file, (lines = new Map()))
    let names = lines.get(line)
    if (!names) lines.set(line, (names = new Map()))
    let frame = names.get(info.name)
    if (!frame) names.set(info.name, (frame = {key: nextFrameKey++, ...info}))
    if (typeof value === 'object') tupleLabels.set(value, frame)
    return frame
  }
  let edges = 0,
    validAttribution = true,
    totalSelf = 0
  for (const [key, value] of records) {
    await reader.checkpoint()
    const frame = label(key)
    if (seen.has(frame.key)) fail('duplicate function source identity')
    seen.add(frame.key)
    const [primitive, calls, selfValue, cumulativeValue, callersValue] = tuple(value, 5)
    if (nonnegative(primitive, true) > nonnegative(calls, true))
      fail('primitive calls exceed total calls')
    const self = nonnegative(selfValue, false),
      cumulative = nonnegative(cumulativeValue, false)
    if (self - cumulative > Math.max(self, cumulative) * 1e-12)
      fail('self time exceeds cumulative time')
    totalSelf = add(totalSelf, self)
    if (self) flat.appendSampleWithWeight([frame], self)
    const callers = dictionary(callersValue),
      callersSeen = new Set<string | number>()
    let attributedSelf = 0
    const pending: {caller: FrameInfo; self: number}[] = []
    for (const [callerKey, callerValue] of callers) {
      await reader.checkpoint()
      if (++edges > CPROFILE_LIMITS.edges) fail('caller edge limit exceeded')
      const caller = label(callerKey)
      if (callersSeen.has(caller.key)) fail('duplicate caller source identity')
      callersSeen.add(caller.key)
      const [edgeCalls, edgePrimitive, edgeSelf, edgeCumulative] = tuple(callerValue, 4)
      if (nonnegative(edgePrimitive, true) > nonnegative(edgeCalls, true))
        fail('primitive edge calls exceed total calls')
      const seconds = nonnegative(edgeSelf, false),
        inclusive = nonnegative(edgeCumulative, false)
      if (seconds - inclusive > Math.max(seconds, inclusive) * 1e-12)
        fail('caller self time exceeds cumulative time')
      attributedSelf = add(attributedSelf, seconds)
      pending.push({caller, self: seconds})
    }
    if (attributedSelf - self > Math.max(self, attributedSelf) * 1e-12) validAttribution = false
    let remaining = self
    for (const edge of pending) {
      await reader.checkpoint()
      const seconds = Math.min(remaining, edge.self)
      if (seconds) attributed.appendSampleWithWeight([edge.caller, frame], seconds)
      remaining = Math.max(0, remaining - seconds)
    }
    if (remaining) attributed.appendSampleWithWeight([frame], remaining)
  }
  abort(options.signal)
  if (!totalSelf) fail('profile contains no positive self time')
  const primary = flat.build()
  primary.setName(
    `${fileName} (flat self time${validAttribution ? '' : '; caller attribution unavailable'})`,
  )
  primary.setChronological(false)
  const profiles = [primary]
  if (validAttribution) {
    const secondary = attributed.build()
    secondary.setName(`${fileName} (immediate-caller self time; not full stacks)`)
    secondary.setChronological(false)
    profiles.push(secondary)
  }
  return {name: fileName, indexToView: 0, profiles}
}
