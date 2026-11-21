import * as pako from 'pako'

export const GENERIC_DECOMPRESSION_LIMITS = Object.freeze({
  expandedBytes: 512 * 1024 * 1024,
  inputChunkBytes: 16 * 1024,
  outputChunkBytes: 16 * 1024,
})
export interface DecompressionOptions {
  signal?: AbortSignal
  yieldToMainThread?: boolean
  // Internal callers can lower, never raise, the generic expansion ceiling.
  maxExpandedBytes?: number
}
class ExpansionLimitError extends Error {
  constructor() {
    super(
      'Compressed profile exceeds the generic expanded-byte limit. Use a streaming format or a smaller recording.',
    )
  }
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}
function gzip(bytes: Uint8Array, offset = 0) {
  return bytes[offset] === 0x1f && bytes[offset + 1] === 0x8b
}
function zlib(bytes: Uint8Array, offset = 0) {
  const first = bytes[offset],
    second = bytes[offset + 1]
  return (first & 15) === 8 && first >>> 4 <= 7 && ((first << 8) + second) % 31 === 0
}
class Chunks {
  private pieces: Uint8Array[] = []
  private size = 0
  private tail: Uint8Array | undefined
  private tailUsed = 0
  constructor(
    private maximum: number,
    private signal?: AbortSignal,
  ) {}
  append(value: Uint8Array) {
    abort(this.signal)
    if (value.length > this.maximum - this.size) throw new ExpansionLimitError()
    // Codec chunks can be one-byte views into 16-KiB backing buffers. Copy
    // into owned slabs so many tiny members cannot retain those hidden bytes
    // or create one retained fragment object per decoded observation.
    let at = 0
    while (at < value.length) {
      if (!this.tail || this.tailUsed === this.tail.length) {
        this.tail = new Uint8Array(
          Math.min(GENERIC_DECOMPRESSION_LIMITS.outputChunkBytes, this.maximum - this.size),
        )
        this.tailUsed = 0
        this.pieces.push(this.tail)
      }
      const length = Math.min(value.length - at, this.tail.length - this.tailUsed)
      this.tail.set(value.subarray(at, at + length), this.tailUsed)
      this.tailUsed += length
      this.size += length
      at += length
    }
  }
  clear() {
    this.pieces = []
    this.size = 0
    this.tail = undefined
    this.tailUsed = 0
  }
  finish(): ArrayBuffer {
    abort(this.signal)
    const only = this.pieces[0]
    if (
      this.pieces.length === 1 &&
      this.size === only.length &&
      only.byteOffset === 0 &&
      only.byteLength === only.buffer.byteLength &&
      only.buffer instanceof ArrayBuffer
    ) {
      const result = only.buffer
      this.clear()
      return result
    }
    const result = new Uint8Array(this.size)
    let at = 0
    for (const piece of this.pieces) {
      const length = Math.min(piece.length, this.size - at)
      result.set(piece.subarray(0, length), at)
      at += length
    }
    this.clear()
    return result.buffer
  }
}

async function nativeGzip(bytes: Uint8Array, chunks: Chunks, options: DecompressionOptions) {
  // Feed bounded compressed pieces: one transform must not receive the whole
  // gzip and queue its entire expansion before the byte guard can run.
  let at = 0,
    lastYield = performance.now()
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      abort(options.signal)
      // Empty gzip members produce no output to drive reader-side checkpoints.
      // Yield while feeding input too, so cancellation still reaches them.
      if (options.yieldToMainThread !== false && performance.now() - lastYield >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0))
        lastYield = performance.now()
        abort(options.signal)
      }
      if (at === bytes.length) controller.close()
      else {
        const end = Math.min(bytes.length, at + GENERIC_DECOMPRESSION_LIMITS.inputChunkBytes)
        controller.enqueue(bytes.subarray(at, end) as Uint8Array<ArrayBuffer>)
        at = end
      }
    },
  })
  const reader = input.pipeThrough(new DecompressionStream('gzip')).getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', cancel, {once: true})
  try {
    while (true) {
      abort(options.signal)
      const next = await reader.read()
      abort(options.signal)
      if (next.done) break
      chunks.append(next.value)
    }
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function inflateFallback(bytes: Uint8Array, chunks: Chunks, options: DecompressionOptions) {
  let at = 0,
    lastYield = performance.now()
  while (at < bytes.length) {
    if (!gzip(bytes, at) && !zlib(bytes, at)) throw new Error('Invalid compressed profile member')
    const inflater = new pako.Inflate({
      chunkSize: GENERIC_DECOMPRESSION_LIMITS.outputChunkBytes,
    } as pako.InflateOptions & {chunkSize: number}) as pako.Inflate & {
      ended: boolean
      strm: {next_in: number}
    }
    inflater.onData = value => chunks.append(value as Uint8Array)
    while (!inflater.ended && at < bytes.length) {
      abort(options.signal)
      const end = Math.min(bytes.length, at + GENERIC_DECOMPRESSION_LIMITS.inputChunkBytes)
      // A forced finish in older pako can accept truncated streams. Require
      // natural stream completion and the validated checksum instead.
      const success = inflater.push(bytes.subarray(at, end), false)
      const consumed = inflater.strm.next_in
      if (!success || inflater.err || consumed <= 0) throw new Error('Invalid compressed profile')
      at += consumed
      if (options.yieldToMainThread !== false && performance.now() - lastYield >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0))
        lastYield = performance.now()
        abort(options.signal)
      }
    }
    if (!inflater.ended || inflater.err) throw new Error('Truncated compressed profile')
    // gzip permits commonly emitted trailing zero padding. Additional gzip or
    // zlib members share the same cumulative expansion budget.
    while (at < bytes.length && bytes[at] === 0) {
      const end = Math.min(bytes.length, at + GENERIC_DECOMPRESSION_LIMITS.inputChunkBytes)
      do {
        at++
      } while (at < end && bytes[at] === 0)
      abort(options.signal)
      if (options.yieldToMainThread !== false && performance.now() - lastYield >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0))
        lastYield = performance.now()
        abort(options.signal)
      }
    }
  }
}

export async function decompressProfileInput(
  input: ArrayBuffer,
  options: DecompressionOptions = {},
): Promise<ArrayBuffer> {
  const maximum = options.maxExpandedBytes ?? GENERIC_DECOMPRESSION_LIMITS.expandedBytes
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > GENERIC_DECOMPRESSION_LIMITS.expandedBytes
  )
    throw new Error('Invalid generic decompression limit')
  abort(options.signal)
  const bytes = new Uint8Array(input)
  if (!gzip(bytes) && !zlib(bytes)) return input
  const chunks = new Chunks(maximum, options.signal)
  try {
    if (
      gzip(bytes) &&
      typeof DecompressionStream !== 'undefined' &&
      typeof ReadableStream !== 'undefined'
    ) {
      try {
        await nativeGzip(bytes, chunks, options)
        return chunks.finish()
      } catch (error) {
        if (options.signal?.aborted || error instanceof ExpansionLimitError) throw error
        chunks.clear()
      }
    }
    await inflateFallback(bytes, chunks, options)
    return chunks.finish()
  } catch (error) {
    chunks.clear()
    if (options.signal?.aborted) abort(options.signal)
    if (error instanceof ExpansionLimitError) throw error
    // Preserve historical raw-input detection for corrupt/unsupported wrappers.
    // Limit and cancellation failures must never be retried as raw data.
    return input
  }
}
