import * as pako from 'pako'
import {createJavaThreadDumpParser, isJavaThreadDump} from './java-thread-dump'
import {ImportProgress} from './trace-worker-protocol'

// Classic ZIP32 structures: PKWARE APPNOTE 6.3.10, sections 4.3.7–4.3.16.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// pako 1.0.6 onData is overridden: it must not accumulate inflate.chunks/result.
// https://github.com/nodeca/pako/blob/1.0.6/lib/inflate.js
export const JAVA_DUMP_ZIP_LIMITS = Object.freeze({
  maxCompressedBytes: 32 * 1024 * 1024,
  maxEntries: 512,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxNameBytes: 512,
  maxDepth: 8,
  maxLineChars: 65536,
})
export type JavaThreadDumpZipLimits = {
  -readonly [K in keyof typeof JAVA_DUMP_ZIP_LIMITS]: number
}
export interface JavaThreadDumpZipOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImportProgress) => void
  // Tests/embedding may lower limits, never raise the production ceilings.
  limits?: Partial<JavaThreadDumpZipLimits>
}
interface Entry {
  name: string
  directory: boolean
  method: number
  compressed: number
  size: number
  crc: number
  data: number
  local: number
  end: number
}
const fail = (message: string): never => {
  throw new Error(`Java thread-dump ZIP: ${message}`)
}
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

export function isJavaThreadDumpZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
  )
}

export async function checkJavaThreadDumpZipFileSize(file: File, signal?: AbortSignal) {
  abort(signal)
  if (file.size <= JAVA_DUMP_ZIP_LIMITS.maxCompressedBytes) return
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  abort(signal)
  if (isJavaThreadDumpZip(signature)) fail('compressed input exceeds its limit')
}

function catalog(bytes: Uint8Array, limits: JavaThreadDumpZipLimits): Entry[] {
  if (bytes.byteLength > limits.maxCompressedBytes) fail('compressed input exceeds its limit')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      end = i
      break
    }
  }
  if (end < 0) fail('missing or malformed end record')
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    fail('split archives are unsupported')
  const count = u16(end + 10),
    centralSize = u32(end + 12),
    central = u32(end + 16)
  if (count === 65535 || central === 0xffffffff || centralSize === 0xffffffff)
    fail('ZIP64 is unsupported')
  if (count > limits.maxEntries) fail('entry count exceeds its limit')
  if (central + centralSize !== end) fail('inconsistent central directory')
  const names = new Map<string, boolean>(),
    entries: Entry[] = []
  let offset = central,
    declaredTotal = 0
  const extra = (start: number, length: number) => {
    const stop = start + length
    for (let p = start; p < stop; ) {
      if (p + 4 > stop) fail('malformed extra field')
      const tag = u16(p),
        size = u16(p + 2)
      if ([0x0001, 0x7075, 0x9901].includes(tag))
        fail('ZIP64, alternate Unicode paths and encryption are unsupported')
      p += 4 + size
      if (p > stop) fail('malformed extra field')
    }
  }
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) fail('malformed central entry')
    const flags = u16(offset + 8),
      method = u16(offset + 10)
    if (flags & ~0x080e) fail('encrypted or unsupported ZIP flags')
    if (method !== 0 && method !== 8) fail('only STORE and DEFLATE compression are supported')
    const compressed = u32(offset + 20),
      size = u32(offset + 24),
      local = u32(offset + 42)
    const nameLength = u16(offset + 28),
      extraLength = u16(offset + 30),
      commentLength = u16(offset + 32)
    if (u16(offset + 34) || [compressed, size, local].includes(0xffffffff))
      fail('split archives and ZIP64 are unsupported')
    if (size > limits.maxEntryBytes || compressed > limits.maxCompressedBytes)
      fail('entry size exceeds its limit')
    declaredTotal += size
    if (declaredTotal > limits.maxTotalBytes) fail('total decompressed size exceeds its limit')
    if (
      !nameLength ||
      nameLength > limits.maxNameBytes ||
      offset + 46 + nameLength + extraLength + commentLength > end
    )
      fail('invalid entry name or header length')
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    if (!(flags & 0x0800) && nameBytes.some(b => b > 127))
      fail('non-ASCII names must declare UTF-8')
    const name = new TextDecoder('utf-8', {fatal: true}).decode(nameBytes)
    const directory = name.endsWith('/')
    const path = directory ? name.slice(0, -1) : name
    const parts = path.split('/')
    if (
      !path ||
      /[\\:\u0000-\u001f\u007f]/.test(name) ||
      parts.length > limits.maxDepth ||
      parts.some(p => !p || p === '.' || p === '..') ||
      name.normalize('NFC') !== name
    )
      fail('unsafe or ambiguous entry path')
    const identity = path.toLowerCase()
    if (names.has(identity)) fail('duplicate or ambiguous entry path')
    names.set(identity, directory)
    const unixType = (u32(offset + 38) >>> 16) & 0xf000
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000)
      fail('links and special files are unsupported')
    if ((unixType === 0x4000 || u32(offset + 38) & 0x10) && !directory)
      fail('directory attributes disagree with path')
    if (directory && size) fail('nonempty directory entry')
    extra(offset + 46 + nameLength, extraLength)
    if (
      local + 30 > central ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameLength
    )
      fail('local and central headers disagree')
    const localExtra = u16(local + 28),
      data = local + 30 + nameLength + localExtra
    if (data + compressed > central) fail('entry exceeds archive data bounds')
    for (let i = 0; i < nameLength; i++)
      if (bytes[local + 30 + i] !== nameBytes[i]) fail('local and central paths disagree')
    extra(local + 30 + nameLength, localExtra)
    const crc = u32(offset + 16)
    if (directory && crc !== 0) fail('directory entry has a nonempty checksum')
    for (const [position, expected] of [
      [14, crc],
      [18, compressed],
      [22, size],
    ]) {
      const actual = u32(local + position)
      if (actual !== expected && (!(flags & 8) || actual !== 0))
        fail('local and central sizes/checksum disagree')
    }
    let stop = data + compressed
    if (flags & 8) {
      if (stop + 12 > central) fail('missing data descriptor')
      const matches = (at: number) =>
        at + 12 <= central && u32(at) === crc && u32(at + 4) === compressed && u32(at + 8) === size
      // The CRC of an unsigned descriptor may itself equal the signature.
      if (matches(stop)) stop += 12
      else if (u32(stop) === 0x08074b50 && matches(stop + 4)) stop += 16
      else fail('invalid data descriptor')
    }
    entries.push({name, directory, method, compressed, size, crc, local, data, end: stop})
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== end) fail('central directory count/size mismatch')
  for (const path of names.keys()) {
    const pieces = path.split('/')
    for (let i = 1; i < pieces.length; i++) {
      if (names.get(pieces.slice(0, i).join('/')) === false)
        fail('a regular file is also used as a parent directory')
    }
  }
  let next = 0
  for (const entry of entries.slice().sort((a, b) => a.local - b.local)) {
    if (entry.local !== next)
      fail('overlapping entries, padding or prefixed executables are unsupported')
    next = entry.end
  }
  if (next !== central) fail('unaccounted archive data')
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export async function importFromJavaThreadDumpZip(
  buffer: ArrayBuffer,
  name: string,
  options: JavaThreadDumpZipOptions = {},
) {
  abort(options.signal)
  const limits: JavaThreadDumpZipLimits = {...JAVA_DUMP_ZIP_LIMITS}
  for (const key of Object.keys(limits) as (keyof JavaThreadDumpZipLimits)[]) {
    const requested = options.limits?.[key]
    if (requested !== undefined) {
      if (!Number.isSafeInteger(requested) || requested < 1 || requested > limits[key])
        fail('invalid resource limit')
      limits[key] = requested
    }
  }
  const bytes = new Uint8Array(buffer),
    entries = catalog(bytes, limits)
  const parser = createJavaThreadDumpParser(name)
  let total = 0,
    recognizedEntries = 0,
    lastYield = performance.now()
  const progress = () => {
    options.onProgress?.({phase: 'Parsing profile', canCancel: true})
    abort(options.signal)
  }
  for (const entry of entries) {
    abort(options.signal)
    if (entry.directory && !entry.compressed) continue
    const candidate = /\.(?:jstack|txt|log|dump|tdump)$/i.test(entry.name)
    const decoder = candidate ? new TextDecoder('utf-8', {fatal: true}) : null
    let count = 0,
      crc = 0xffffffff,
      carry = '',
      recognized = false
    const line = (value: string) => {
      if (!recognized && count <= 65536 && isJavaThreadDump(value)) {
        recognized = true
        recognizedEntries++
      }
      if (recognized) parser.pushLine(value)
    }
    const text = (value: string) => {
      let from = 0,
        at: number
      while ((at = value.indexOf('\n', from)) !== -1) {
        if (carry.length + at - from > limits.maxLineChars) fail('text line exceeds its limit')
        line(carry + value.slice(from, at))
        carry = ''
        from = at + 1
      }
      if (carry.length + value.length - from > limits.maxLineChars)
        fail('text line exceeds its limit')
      carry += value.slice(from)
    }
    const consume = (chunk: Uint8Array) => {
      abort(options.signal)
      count += chunk.length
      total += chunk.length
      // Check actual expansion before CRC, decoding, line retention or parser work.
      if (count > limits.maxEntryBytes || total > limits.maxTotalBytes)
        fail('actual decompressed bytes exceed their limit')
      if (count > entry.size) fail('actual decompressed size exceeds declared entry size')
      for (const value of chunk) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8)
      if (decoder) text(decoder.decode(chunk, {stream: true}))
    }
    progress()
    if (entry.method === 0) {
      for (let p = 0; p < entry.compressed; p += 16384) {
        consume(bytes.subarray(entry.data + p, entry.data + Math.min(p + 16384, entry.compressed)))
        if (performance.now() - lastYield >= 8) {
          await new Promise(resolve => setTimeout(resolve, 0))
          lastYield = performance.now()
          progress()
        }
      }
    } else {
      const inflate = new pako.Inflate({raw: true, chunkSize: 16384} as pako.InflateOptions & {
        chunkSize: number
      }) as pako.Inflate & {
        ended: boolean
        strm: {total_in: number}
      }
      inflate.onData = data => consume(data as Uint8Array)
      for (let p = 0; p < entry.compressed; p += 1024) {
        abort(options.signal)
        if (
          !inflate.push(
            bytes.subarray(entry.data + p, entry.data + Math.min(p + 1024, entry.compressed)),
            false,
          )
        )
          fail('invalid DEFLATE stream')
        if (performance.now() - lastYield >= 8) {
          await new Promise(resolve => setTimeout(resolve, 0))
          lastYield = performance.now()
          progress()
        }
      }
      if (!inflate.ended || inflate.err || inflate.strm.total_in !== entry.compressed)
        fail('truncated or trailing DEFLATE data')
    }
    if (count !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
      fail('decompressed size or CRC32 mismatch')
    if (decoder) {
      text(decoder.decode())
      line(carry)
    }
    if (/\.jstack$/i.test(entry.name) && !recognized)
      fail('jstack entry has no Full thread dump header near its start')
    parser.endEntry()
  }
  progress()
  if (!recognizedEntries) fail('archive contains no UTF-8 Java thread-dump text entries')
  return parser.build()
}
