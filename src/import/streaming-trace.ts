import {Tokenizer, TokenParser, TokenType} from '@streamparser/json'
import {ProfileGroup} from '../lib/profile'
import {importTraceEvents, TraceEvent} from './trace-event'
import {StringBackedTextFileContent} from './utils'
import {sourceFileName} from '../lib/profile-context'

// These are input-complexity limits, not measurements of browser heap usage.
// Profile construction and rendering still need memory proportional to the trace.
export const TRACE_STREAM_LIMITS = {
  maxBytes: 1024 * 1024 * 1024,
  maxPendingBytes: 16 * 1024 * 1024,
  maxRetainedBytes: 256 * 1024 * 1024,
  maxEvents: 2_000_000,
  maxDepth: 128,
}
export interface TraceStreamOptions {
  limits?: Partial<typeof TRACE_STREAM_LIMITS>
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

export class TraceImportLimitError extends Error {
  constructor(limit: string) {
    super(
      `Trace import limit exceeded (${limit}). Record a shorter capture or filter it before importing.`,
    )
    this.name = 'TraceImportLimitError'
  }
}
class NotDurationTrace extends Error {}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}

// No whole-document string or parsed event array is created. Only one event is
// assembled at a time; unmatched root properties and ignored events are dropped.
// Events must still be retained for stable sorting of out-of-order timestamps.
export async function importDurationTraceStream(
  stream: ReadableStream<Uint8Array>,
  name: string,
  options: TraceStreamOptions = {},
): Promise<ProfileGroup | null> {
  const limits = {...TRACE_STREAM_LIMITS, ...options.limits}
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid trace import limits')
  const reader = stream.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', abort, {once: true})
  // Most trace strings are short. Avoid an encode/decode round trip for each;
  // the pending-byte limit also bounds an unfinished long token.
  const tokenizer = new Tokenizer({stringBufferSize: 0})
  let parser: TokenParser | undefined
  let rootArray = false
  let depth = 0
  let started = false
  let leadingBytes = 0
  let skippedBytes = 0
  let bomBytes = 0
  let previous: TokenType | undefined
  let rootKey = ''
  let sawTraceEvents = false
  let pendingComma: Parameters<TokenParser['write']>[0] | undefined
  let offset = 0
  let eventStart = 0
  let completedOffset = 0
  let bytes = 0
  let retainedBytes = 0
  let count = 0
  let lastProgress = 0
  let framedEvent: unknown
  const events: TraceEvent[] = []

  const acceptEvent = (value: unknown) => {
    completedOffset = offset + 1
    if (++count > limits.maxEvents) throw new TraceImportLimitError('event count')
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('ph' in value))
      throw new NotDurationTrace()
    const event = value as TraceEvent
    // Chrome sampled CPU events and Hermes sample tables need the original
    // detector. This check deliberately includes markers late in the document.
    if (event.name === 'CpuProfile' || event.name === 'Profile' || event.name === 'ProfileChunk')
      throw new NotDurationTrace()
    const duration = event.ph === 'B' || event.ph === 'E' || event.ph === 'X'
    if (duration && !('ts' in event)) throw new NotDurationTrace()
    const metadata =
      event.ph === 'M' && (event.name === 'process_name' || event.name === 'thread_name')
    if (duration || metadata || count === 1) {
      retainedBytes += offset - eventStart + 1
      if (retainedBytes > limits.maxRetainedBytes)
        throw new TraceImportLimitError('retained event bytes')
      // Keep the first event for the existing Hermes format discriminator.
      // Preserve argument identity/order: it participates in frame keys.
      events.push({
        ph: event.ph,
        ts: event.ts,
        pid: event.pid,
        tid: event.tid,
        name: event.name,
        args: event.args,
        ...(event.ph === 'X' ? {dur: (event as any).dur, tdur: (event as any).tdur} : {}),
      })
    }
  }
  tokenizer.onToken = info => {
    const {token, value} = info
    offset = info.offset + leadingBytes + skippedBytes
    if (!parser) {
      if (token !== TokenType.LEFT_BRACKET && token !== TokenType.LEFT_BRACE)
        throw new NotDurationTrace()
      rootArray = token === TokenType.LEFT_BRACKET
      parser = new TokenParser({
        paths: rootArray ? ['$.*'] : ['$.traceEvents.*'],
        keepStack: false,
      })
      parser.onValue = ({value: parsedValue}) => acceptEvent(framedEvent ?? parsedValue)
    }
    if (
      !rootArray &&
      depth === 1 &&
      token === TokenType.STRING &&
      (previous === TokenType.LEFT_BRACE || previous === TokenType.COMMA)
    ) {
      rootKey = value as string
      if (
        ![
          'traceEvents',
          'displayTimeUnit',
          'metadata',
          'otherData',
          'systemTraceEvents',
          'controllerTraceData',
        ].includes(rootKey)
      )
        throw new NotDurationTrace()
      if (rootKey === 'traceEvents') {
        if (sawTraceEvents) throw new NotDurationTrace() // duplicate keys: native last-key wins
        sawTraceEvents = true
      }
    }
    if (!rootArray && depth === 1 && previous === TokenType.COLON && rootKey === 'traceEvents') {
      if (token !== TokenType.LEFT_BRACKET) throw new NotDurationTrace()
    }
    const eventDepth = rootArray ? 1 : 2
    if (depth === eventDepth && token === TokenType.LEFT_BRACE) eventStart = offset
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
      if (++depth > limits.maxDepth) throw new TraceImportLimitError('JSON nesting depth')
    } else if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) depth--

    // Match the ordinary importer's trailing-comma tolerance without modifying
    // strings. Delay commas until the next token establishes whether to keep it.
    if (pendingComma) {
      if (token !== TokenType.RIGHT_BRACE && token !== TokenType.RIGHT_BRACKET)
        parser.write(pendingComma)
      pendingComma = undefined
    }
    if (token === TokenType.COMMA) pendingComma = info
    else parser.write(info)
    previous = token
  }

  // Frame complete event objects with a cheap structural scan, then let native
  // JSON.parse handle their fields. The token parser still validates the outer
  // document and consumes each object as one value. No trace-sized string is
  // constructed, and records spanning chunks stay within the same byte limits.
  const decoder = new TextDecoder()
  let scanDepth = 0
  let inString = false
  let escaped = false
  let capturing = false
  let captureDepth = 0
  let captureStart = 0
  const parts: Uint8Array[] = []
  const writeOutside = (chunk: Uint8Array) => {
    if (chunk.length) tokenizer.write(chunk)
  }
  const writeChunk = (chunk: Uint8Array, absoluteStart: number) => {
    let segmentStart = 0
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      if (inString) {
        if (escaped) escaped = false
        else if (byte === 0x5c) escaped = true
        else if (byte === 0x22) inString = false
      } else if (byte === 0x22) inString = true
      else if (byte === 0x7b || byte === 0x5b) {
        if (!capturing && byte === 0x7b && (scanDepth === 1 || scanDepth === 2)) {
          writeOutside(chunk.subarray(segmentStart, i))
          segmentStart = i
          if (
            (rootArray && scanDepth === 1) ||
            (!rootArray && rootKey === 'traceEvents' && scanDepth === 2)
          ) {
            capturing = true
            captureDepth = scanDepth
            captureStart = absoluteStart + i
          }
        }
        scanDepth++
        if (capturing && scanDepth > limits.maxDepth)
          throw new TraceImportLimitError('JSON nesting depth')
      } else if (byte === 0x7d || byte === 0x5d) {
        scanDepth--
        if (capturing && scanDepth === captureDepth) {
          const last = chunk.subarray(segmentStart, i + 1)
          let data = last
          if (parts.length) {
            data = new Uint8Array(absoluteStart + i + 1 - captureStart)
            let cursor = 0
            for (const part of parts) {
              data.set(part, cursor)
              cursor += part.length
            }
            data.set(last, cursor)
          }
          const text = decoder.decode(data)
          let value
          try {
            value = JSON.parse(text)
          } catch {
            // Trailing commas are uncommon, so pay for the permissive retry
            // only when native parsing fails. String literals remain intact.
            value = new StringBackedTextFileContent(text).parseAsJSON()
          }
          eventStart = captureStart
          // Validate this event's position in the outer JSON grammar with an
          // opaque null placeholder; consume its already-parsed value above.
          framedEvent = value
          tokenizer.onToken({
            token: TokenType.NULL,
            value: null,
            offset: absoluteStart + i - leadingBytes - skippedBytes,
          })
          framedEvent = undefined
          skippedBytes += data.length
          parts.length = 0
          capturing = false
          segmentStart = i + 1
        }
      }
    }
    if (capturing) parts.push(chunk.subarray(segmentStart))
    else writeOutside(chunk.subarray(segmentStart))
  }

  try {
    checkAbort(options.signal)
    while (true) {
      const {done, value} = await reader.read()
      checkAbort(options.signal)
      if (done) break
      // Some sources produce a single huge chunk. Bound writes ourselves so a
      // token cannot accumulate unbounded memory between budget checks.
      for (let start = 0; start < value.length; start += 64 * 1024) {
        const chunk = value.subarray(start, start + 64 * 1024)
        bytes += chunk.length
        if (bytes > limits.maxBytes) throw new TraceImportLimitError('decompressed input bytes')
        if (bytes - completedOffset > limits.maxPendingBytes)
          throw new TraceImportLimitError('event or metadata size')
        let prefix = 0
        while (!started && prefix < chunk.length) {
          const byte = chunk[prefix]
          if (bomBytes || (leadingBytes === 0 && byte === 0xef)) {
            if (byte !== [0xef, 0xbb, 0xbf][bomBytes]) throw new NotDurationTrace()
            bomBytes = (bomBytes + 1) % 3
          } else if (![9, 10, 13, 32].includes(byte)) {
            if (byte !== 0x5b && byte !== 0x7b) throw new NotDurationTrace()
            started = true
            break
          }
          prefix++
          leadingBytes++
        }
        if (started) writeChunk(chunk.subarray(prefix), bytes - chunk.length + prefix)
      }
      if (bytes - lastProgress >= 8 * 1024 * 1024) {
        options.onProgress?.(bytes)
        lastProgress = bytes
      }
    }
    if (!started) return null
    if (capturing) throw new Error('Incomplete trace JSON value')
    tokenizer.end()
    // A producer can stop after a complete array event without writing ']'.
    // Unterminated strings, objects and other truncated values still fail.
    if (rootArray && depth === 1 && events.length && parser && !parser.isEnded) {
      pendingComma = undefined
      parser.write({token: TokenType.RIGHT_BRACKET, value: ']'})
      depth--
    }
    if (!parser || (!rootArray && !sawTraceEvents) || !count) return null
    if (pendingComma && !rootArray) parser.write(pendingComma)
    if (!parser.isEnded || depth !== 0) throw new Error('Incomplete trace JSON document')
    checkAbort(options.signal)
    options.onProgress?.(bytes)
    checkAbort(options.signal)
    const group = importTraceEvents(events)
    group.name = name
    group.sourceName = sourceFileName(name)
    return group
  } catch (error) {
    if (error instanceof NotDurationTrace) return null
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
    // A source's cancellation hook may never settle. Don't let it hide a limit
    // or parse error, or keep an aborted import pending.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// Null means the existing detector must handle this input, never a partial
// duration result. A File is reopened on fallback; ArrayBuffer ownership stays
// with the worker until the final response is posted.
export async function tryImportDurationTrace(
  input: ArrayBuffer | File,
  name: string,
  options: TraceStreamOptions = {},
): Promise<ProfileGroup | null> {
  const plainName = name.replace(/\.gz$/i, '')
  if (
    !/\.(?:json|trace)$/i.test(plainName) ||
    /\.(?:speedscope|chrome|stackprof|v8log)\.json$/i.test(plainName) ||
    /(?:Trace|Profile)-\d{8}T\d{6}/.test(plainName)
  )
    return null
  checkAbort(options.signal)
  const buffer = input instanceof ArrayBuffer
  const header = buffer
    ? new Uint8Array(input, 0, Math.min(input.byteLength, 2))
    : new Uint8Array(await input.slice(0, 2).arrayBuffer())
  const gzip = header[0] === 0x1f && header[1] === 0x8b
  if (gzip && typeof DecompressionStream === 'undefined') return null
  let stream: ReadableStream<Uint8Array<ArrayBuffer>>
  if (buffer) {
    let position = 0
    stream = new ReadableStream({
      pull(controller) {
        const length = Math.min(64 * 1024, input.byteLength - position)
        if (!length) controller.close()
        else {
          controller.enqueue(new Uint8Array(input, position, length))
          position += length
        }
      },
    })
  } else {
    if (typeof input.stream !== 'function') return null
    stream = input.stream()
  }
  if (gzip) stream = stream.pipeThrough(new DecompressionStream('gzip'))
  return importDurationTraceStream(stream, name, options)
}
