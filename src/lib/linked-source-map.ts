import {tokenizer} from 'acorn'
import {Frame, Profile, SymbolRemapper} from './profile'
import {importJavaScriptSourceMapSymbolRemapper} from './js-source-map'

const MAX_SCRIPT_BYTES = 8 * 1024 * 1024
const MAX_MAP_BYTES = 2 * 1024 * 1024
const MAX_MAPPINGS = 100000
const MAX_CHANGED_FRAMES = 100000
const REQUEST_TIMEOUT_MS = 30000

export interface LinkedSourceMapPreview {
  generatedURL: string
  mapURL: string
  changedFrames: number
  remapper: SymbolRemapper
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Source-map load cancelled', 'AbortError')
}

function httpURL(input: string, base?: string): URL {
  let url: URL
  try {
    url = new URL(input, base)
  } catch {
    throw new Error('Enter an absolute HTTP or HTTPS generated-script URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(
      'Only HTTP(S) source-map URLs without embedded credentials are supported. Import local .map files with Import.',
    )
  url.hash = ''
  return url
}

async function readText(response: Response, limit: number, signal: AbortSignal, label: string) {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`${label} request failed (HTTP ${response.status}).`)
  }
  const declared = response.headers.get('Content-Length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    await response.body?.cancel()
    throw new Error(`${label} exceeds its ${limit / 1024 / 1024} MiB download limit.`)
  }
  if (!response.body) throw new Error(`${label} response has no readable body.`)
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let bytes = 0,
    text = ''
  try {
    while (true) {
      checkAbort(signal)
      const part = await reader.read()
      checkAbort(signal)
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > limit)
        throw new Error(`${label} exceeds its ${limit / 1024 / 1024} MiB download limit.`)
      text += decoder.decode(part.value, {stream: true})
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function request(url: URL, signal: AbortSignal, label: string) {
  checkAbort(signal)
  try {
    return await fetch(url.href, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    checkAbort(signal)
    throw new Error(
      `${label} could not be fetched. The server must permit CORS; redirects and credentialed requests are not followed. Import a local .map file instead.`,
    )
  }
}

// Use a JavaScript tokenizer, not a comment regex over arbitrary source text:
// sourceMappingURL-looking strings/templates must never select a network URL.
// Only trailing comments following the last code token can supply a link.
// https://tc39.es/ecma426/2024/#sec-extracting-a-source-map-url-from-javascript-sources
export async function linkedMapComment(
  source: string,
  signal: AbortSignal,
): Promise<string | null> {
  let candidate: string | null = null
  try {
    const tokens = tokenizer(source, {
      ecmaVersion: 2020,
      allowHashBang: true,
      onComment: (_block, text) => {
        const match = /^[@#]\s*sourceMappingURL=(\S+?)\s*$/.exec(text)
        if (match) candidate = match[1]
      },
    })
    let count = 0
    while (true) {
      checkAbort(signal)
      const token = tokens.getToken()
      if (token.type.label === 'eof') return candidate
      candidate = null
      if (++count % 4096 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
  } catch (error) {
    checkAbort(signal)
    throw new Error(
      'Could not safely read the generated script annotation. Use an exposed SourceMap response header or import the .map file locally.',
    )
  }
}

export async function previewLinkedSourceMap(
  profiles: readonly Profile[],
  sourceURL: string,
  signal: AbortSignal,
  onStatus: (status: string) => void = () => {},
): Promise<LinkedSourceMapPreview> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, {once: true})
  if (signal.aborted) controller.abort()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    const activeSignal = controller.signal,
      generated = httpURL(sourceURL)
    onStatus('Loading generated script…')
    const response = await request(generated, activeSignal, 'Generated script')
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Generated script request failed (HTTP ${response.status}).`)
    }
    const header = response.headers.get('SourceMap') || response.headers.get('X-SourceMap')
    let annotation: string | null
    if (header) {
      await response.body?.cancel()
      annotation = header.trim()
    } else
      annotation = await linkedMapComment(
        await readText(response, MAX_SCRIPT_BYTES, activeSignal, 'Generated script'),
        activeSignal,
      )
    if (!annotation)
      throw new Error(
        'No trailing sourceMappingURL comment or accessible SourceMap header was found. Import the .map file locally.',
      )
    const map = httpURL(annotation, generated.href)
    onStatus('Loading linked source map…')
    const raw = await readText(
      await request(map, activeSignal, 'Source map'),
      MAX_MAP_BYTES,
      activeSignal,
      'Source map',
    )
    const text = raw.startsWith(")]}'") ? raw.slice(raw.indexOf('\n') + 1) : raw
    checkAbort(activeSignal)
    onStatus('Checking source mappings…')
    const remapper = await importJavaScriptSourceMapSymbolRemapper(text, map.href, {
      generatedFile: generated.href,
      maxMappings: MAX_MAPPINGS,
      sourceMapURL: map.href,
    })
    checkAbort(activeSignal)
    if (!remapper)
      throw new Error('The linked file is not a supported source map with usable mappings.')
    const changes = new Map<Frame, NonNullable<ReturnType<SymbolRemapper>>>()
    let checked = 0
    for (const profile of profiles)
      for (const frame of profile.getFrames()) {
        checkAbort(activeSignal)
        if (!changes.has(frame)) {
          const change = remapper(frame)
          if (
            change &&
            Object.entries(change).some(
              ([field, value]) => value !== undefined && value !== frame[field as keyof Frame],
            )
          ) {
            if (changes.size >= MAX_CHANGED_FRAMES)
              throw new Error(
                'More than 100,000 frames would change. Use a smaller recording or import a local map.',
              )
            changes.set(frame, change)
          }
        }
        if (++checked % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
    checkAbort(activeSignal)
    if (!changes.size)
      throw new Error(
        'No frames match this generated-script URL with usable line and column positions. Check the URL or import a local .map file.',
      )
    return {
      generatedURL: generated.href,
      mapURL: map.href,
      changedFrames: changes.size,
      remapper: frame => changes.get(frame) || null,
    }
  } catch (error) {
    if (timedOut)
      throw new Error(
        'Source-map loading timed out after 30 seconds. Import a local .map file or try again.',
      )
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
