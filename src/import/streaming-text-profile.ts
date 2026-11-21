import {ProfileGroup, StackListProfileBuilder} from '../lib/profile'
import {sourceFileName} from '../lib/profile-context'
import {parseBGFoldedStack} from './bg-flamegraph'
import {createLinuxPerfParser} from './linux-tools-perf'
import {createDifferentialFoldedParser, isDifferentialFoldedName} from './bg-differential'

export const TEXT_STREAM_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024 * 1024,
  maxLineChars: 1024 * 1024,
  maxPerfEventChars: 4 * 1024 * 1024,
  maxStackDepth: 65536,
  maxSamples: 2_000_000,
})
export type TextStreamLimits = {-readonly [K in keyof typeof TEXT_STREAM_LIMITS]: number}
export interface TextStreamOptions {
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
  limits?: Partial<TextStreamLimits>
  // UI callers need timer yields so input/cancellation events can run. A
  // dedicated worker is terminated externally and can skip this timer overhead.
  yieldToMainThread?: boolean
}
type TextProfileKind = 'folded' | 'differential' | 'perf' | 'auto'
class NotTextProfile extends Error {}

export function textProfileKind(name: string): TextProfileKind | null {
  if (isDifferentialFoldedName(name)) return 'differential'
  const plain = name.replace(/\.gz$/i, '')
  if (/\.(?:folded|collapsed|stacks)$|\.collapsedstack\.txt$/i.test(plain)) return 'folded'
  if (/\.linux-perf\.txt$|\.perf(?:\.txt)?$/i.test(plain)) return 'perf'
  return /\.txt$/i.test(plain) ? 'auto' : null
}
const perfHeader = (line: string) =>
  /^\s*(\S.*?)\s+\d+(?:\/\d+)?\s+/.test(line) && /\s+\d+\.\d+:\s+/.test(line)
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
const limit = (name: string): never => {
  throw new Error(
    `Streaming text import limit exceeded (${name}). Record or export a smaller capture.`,
  )
}

// Decode bounded pieces and feed one line/event at a time to the same parsers
// as ordinary imports. No whole expanded byte buffer, text or line array.
// Output trees/samples still scale with the capture; these are input limits.
export async function importTextProfileStream(
  stream: ReadableStream<Uint8Array>,
  name: string,
  kind: TextProfileKind,
  options: TextStreamOptions = {},
): Promise<ProfileGroup | null> {
  const limits: TextStreamLimits = {...TEXT_STREAM_LIMITS, ...options.limits}
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid text import limits')
  const reader = stream.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', cancel, {once: true})
  const decoder = new TextDecoder('utf-8')
  const prefix = new Uint8Array(4)
  let prefixLength = 0,
    prefixReady = false,
    carry = '',
    bytes = 0,
    samples = 0,
    lastProgress = 0,
    lastYield = performance.now()
  let detected: 'folded' | 'differential' | 'perf' | null = kind === 'auto' ? null : kind
  const differential =
    kind === 'differential' ? createDifferentialFoldedParser(name, limits.maxStackDepth) : null
  const folded = new StackListProfileBuilder()
  folded.setChronological(false)
  const perf = createLinuxPerfParser({
    maxPendingChars: limits.maxPerfEventChars,
    maxStackDepth: limits.maxStackDepth,
    maxSamples: limits.maxSamples,
  })
  const line = (value: string) => {
    if (differential) {
      if (differential.pushLine(value) && ++samples > limits.maxSamples) limit('sample count')
      return
    }
    let cachedSample: ReturnType<typeof parseBGFoldedStack> | undefined
    const foldedSample = () => {
      if (cachedSample === undefined) cachedSample = parseBGFoldedStack(value, limits.maxStackDepth)
      return cachedSample
    }
    // Preserve generic detector priority for other recognizable text formats.
    if (
      (/^\s*[\[{]/.test(value) && !foldedSample()) ||
      /^\uFEFF?Full thread dump /.test(value) ||
      /^# callgrind format|^events:|^\*version|^(?:Stack_|Script_|Obj_)\S+ log opened/.test(
        value,
      ) ||
      /^[\w \t()]*\tSymbol Names?/.test(value)
    )
      throw new NotTextProfile()
    if (!detected) {
      if (perfHeader(value)) detected = 'perf'
      else {
        if (/^\s*#/.test(value)) return
        if (!foldedSample()) return
        detected = 'folded'
      }
    }
    if (detected === 'perf') perf.pushLine(value)
    else {
      // A mixed/ambiguous .txt file must be retried by the generic detector,
      // which gives perf priority; never return a partial folded result.
      if (perfHeader(value)) throw new NotTextProfile()
      const sample = foldedSample()
      if (!sample) return
      if (++samples > limits.maxSamples) limit('sample count')
      folded.appendSampleWithWeight(sample.stack, sample.duration)
    }
  }
  const text = (value: string) => {
    // Reject recognizable JSON before waiting for its first newline. A renamed
    // minified JSON capture may be much larger than the pending-line limit.
    // Bracketed folded symbols such as [unknown] are still ordinary labels.
    if (!differential && samples === 0) {
      const textPrefix =
        carry.replace(/^\s+/, '').slice(0, 64) + value.replace(/^\s+/, '').slice(0, 64)
      if (/^\{|^\[\s*(?:[\[\{"\]\d-]|true|false|null)/.test(textPrefix)) throw new NotTextProfile()
    }
    let start = 0,
      at: number
    while ((at = value.indexOf('\n', start)) !== -1) {
      if (carry.length + at - start > limits.maxLineChars) limit('line size')
      line(carry + value.slice(start, at))
      carry = ''
      start = at + 1
    }
    if (carry.length + value.length - start > limits.maxLineChars) limit('line size')
    carry += value.slice(start)
  }
  const inspectPrefix = () => {
    // The ordinary decoder supports UTF-16 and binary formats. Return original
    // ownership for fallback instead of decoding those as UTF-8 folded text.
    for (const byte of prefix.subarray(0, prefixLength))
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) throw new NotTextProfile()
    if ((prefix[0] === 0xff && prefix[1] === 0xfe) || (prefix[0] === 0xfe && prefix[1] === 0xff))
      throw new NotTextProfile()
    text(decoder.decode(prefix.subarray(0, prefixLength), {stream: true}))
    prefixReady = true
  }
  try {
    abort(options.signal)
    options.onProgress?.(0)
    abort(options.signal)
    while (true) {
      const next = await reader.read()
      abort(options.signal)
      if (next.done) break
      const chunk = next.value
      bytes += chunk.length
      if (bytes > limits.maxBytes) limit('expanded byte count')
      let offset = 0
      if (!prefixReady) {
        const length = Math.min(4 - prefixLength, chunk.length)
        prefix.set(chunk.subarray(0, length), prefixLength)
        prefixLength += length
        offset = length
        if (prefixLength === 4) inspectPrefix()
      }
      if (prefixReady)
        for (; offset < chunk.length; offset += 65536) {
          abort(options.signal)
          text(decoder.decode(chunk.subarray(offset, offset + 65536), {stream: true}))
          if (options.yieldToMainThread !== false && performance.now() - lastYield >= 8) {
            options.onProgress?.(bytes)
            abort(options.signal)
            await new Promise(resolve => setTimeout(resolve, 0))
            lastYield = performance.now()
            abort(options.signal)
          }
        }
      if (bytes - lastProgress >= 8 * 1024 * 1024) {
        options.onProgress?.(bytes)
        lastProgress = bytes
      }
    }
    if (!prefixReady) inspectPrefix()
    text(decoder.decode())
    if (carry) line(carry)
    abort(options.signal)
    const group = differential
      ? differential.build()
      : detected === 'perf'
        ? perf.build()
        : samples
          ? {name, indexToView: 0, profiles: [folded.build()]}
          : null
    if (!group) return null
    if (!group.name) group.name = name
    for (const profile of group.profiles) if (!profile.getName()) profile.setName(name)
    group.sourceName = sourceFileName(name)
    options.onProgress?.(bytes)
    abort(options.signal)
    return group
  } catch (error) {
    if (error instanceof NotTextProfile) return null
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// Named UTF-8 folded/perf formats and auto-detected .txt are supported. Other
// formats retain their original input for the generic importer. Native gzip is
// required; without it fallback decompresses through the existing reader.
export async function tryImportTextProfile(
  input: ArrayBuffer | File,
  name: string,
  options: TextStreamOptions = {},
) {
  const kind = textProfileKind(name)
  if (!kind || typeof TextDecoder === 'undefined') return null
  abort(options.signal)
  const buffer = input instanceof ArrayBuffer
  const header = buffer
    ? new Uint8Array(input, 0, Math.min(2, input.byteLength))
    : new Uint8Array(await input.slice(0, 2).arrayBuffer())
  const gzip = header[0] === 0x1f && header[1] === 0x8b
  if (gzip && typeof DecompressionStream === 'undefined') return null
  let decompression: DecompressionStream | undefined
  if (gzip) {
    try {
      decompression = new DecompressionStream('gzip')
    } catch {
      return null
    }
  }
  let stream: ReadableStream<Uint8Array<ArrayBuffer>>
  if (buffer) {
    let offset = 0
    stream = new ReadableStream({
      pull(controller) {
        const length = Math.min(65536, input.byteLength - offset)
        if (!length) controller.close()
        else {
          controller.enqueue(new Uint8Array(input, offset, length))
          offset += length
        }
      },
    })
  } else {
    if (typeof input.stream !== 'function') return null
    stream = input.stream()
  }
  if (decompression) stream = stream.pipeThrough(decompression)
  return importTextProfileStream(stream, name, kind, options)
}
