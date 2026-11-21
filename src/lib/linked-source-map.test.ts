/** @jest-environment node */
import {linkedMapComment, previewLinkedSourceMap} from './linked-source-map'
import {importJavaScriptSourceMapSymbolRemapper} from './js-source-map'
import {StackListProfileBuilder} from './profile'

const originalFetch = globalThis.fetch
const mockFetch = jest.fn()
beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  jest.useRealTimers()
})
const sourceURL = 'https://example.com/assets/app.js'
const mapText = JSON.stringify({
  version: 3,
  file: 'a-different-generated-name.js',
  sources: ['../src/original.ts'],
  names: ['originalName'],
  mappings: 'AAAAA',
})
function profile() {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [
      {key: 'chosen', name: 'minified', file: sourceURL, line: 1, col: 1},
      {key: 'other', name: 'other', file: 'https://other.example/assets/app.js', line: 1, col: 1},
    ],
    4,
  )
  return builder.build()
}
const signal = () => new AbortController().signal

test('only real trailing comments supply sourceMappingURL annotations', async () => {
  expect(await linkedMapComment('const value="//# sourceMappingURL=secret.map";', signal())).toBe(
    null,
  )
  expect(
    await linkedMapComment('const value=`\n//# sourceMappingURL=secret.map\n`;', signal()),
  ).toBe(null)
  expect(await linkedMapComment('//# sourceMappingURL=before.map\nrun();', signal())).toBe(null)
  expect(
    await linkedMapComment(
      'run();\n//# sourceMappingURL=first.map\n/*# sourceMappingURL=last.map */',
      signal(),
    ),
  ).toBe('last.map')
  expect(
    await linkedMapComment(
      'run();\n//@ sourceMappingURL=old.map\n// ordinary trailing comment',
      signal(),
    ),
  ).toBe('old.map')
})

test('linked map preview binds the chosen URL, resolves source URLs, and never mutates before Apply', async () => {
  mockFetch
    .mockResolvedValueOnce(
      new Response('function run(){}\n//# sourceMappingURL=../maps/hashed.map'),
    )
    .mockResolvedValueOnce(new Response(mapText))
  const input = profile(),
    statuses: string[] = []
  const preview = await previewLinkedSourceMap([input], sourceURL, signal(), status =>
    statuses.push(status),
  )
  expect(mockFetch.mock.calls.map(call => call[0])).toEqual([
    sourceURL,
    'https://example.com/maps/hashed.map',
  ])
  expect(mockFetch.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    mode: 'cors',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  })
  expect(preview.changedFrames).toBe(1)
  expect(input.getFrame('chosen')!.name).toBe('minified')
  expect(preview.remapper(input.getFrame('other')!)).toBe(null)
  input.remapSymbols(preview.remapper)
  expect(input.getFrame('chosen')).toMatchObject({
    name: 'originalName',
    file: 'https://example.com/src/original.ts',
    line: 1,
    col: 1,
  })
  expect(input.getFrame('other')!.name).toBe('other')
  expect(input.getTotalWeight()).toBe(4)
  expect(statuses).toHaveLength(3)
})

test('SourceMap response header has precedence and avoids parsing or consuming script bytes', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true
    },
  })
  mockFetch
    .mockResolvedValueOnce(
      new Response(body, {
        headers: {
          SourceMap: 'https://maps.example/release/selected.map',
          'X-SourceMap': 'wrong.map',
        },
      }),
    )
    .mockResolvedValueOnce(new Response(mapText))
  const preview = await previewLinkedSourceMap([profile()], sourceURL, signal())
  expect(preview.mapURL).toBe('https://maps.example/release/selected.map')
  expect(cancelled).toBe(true)
  expect(mockFetch).toHaveBeenCalledTimes(2)
})

test('unsafe source/link URLs and missing annotations never trigger a second request', async () => {
  for (const url of [
    'file:///private/app.js',
    'javascript:alert(1)',
    'https://user:password@example.com/app.js',
    'relative.js',
  ]) {
    await expect(previewLinkedSourceMap([profile()], url, signal())).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  }
  mockFetch.mockResolvedValueOnce(
    new Response('run();\n//# sourceMappingURL=file:///private/app.js.map'),
  )
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow(
    'Only HTTP(S)',
  )
  expect(mockFetch).toHaveBeenCalledTimes(1)
  mockFetch.mockReset()
  mockFetch.mockResolvedValueOnce(new Response('run();'))
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow(
    'No trailing sourceMappingURL',
  )
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

test('HTTP/CORS errors are actionable and remote byte limits cancel oversized bodies', async () => {
  mockFetch.mockResolvedValueOnce(new Response('not found', {status: 404}))
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow('HTTP 404')
  mockFetch.mockReset()
  mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow('CORS')
  let cancelled = false
  mockFetch.mockReset()
  mockFetch.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      {headers: {'Content-Length': String(9 * 1024 * 1024)}},
    ),
  )
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow('8 MiB')
  expect(cancelled).toBe(true)
  mockFetch.mockReset()
  mockFetch
    .mockResolvedValueOnce(new Response('', {headers: {SourceMap: 'app.js.map'}}))
    .mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1)))
  await expect(previewLinkedSourceMap([profile()], sourceURL, signal())).rejects.toThrow('2 MiB')
})

test('abort before/during fetch cancels work and timeout has a distinct error', async () => {
  const already = new AbortController()
  already.abort()
  await expect(
    previewLinkedSourceMap([profile()], sourceURL, already.signal),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(mockFetch).not.toHaveBeenCalled()
  const controller = new AbortController()
  mockFetch.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      }),
  )
  const pending = previewLinkedSourceMap([profile()], sourceURL, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({name: 'AbortError'})
  jest.useFakeTimers()
  const timed = previewLinkedSourceMap([profile()], sourceURL, signal())
  jest.advanceTimersByTime(30000)
  await expect(timed).rejects.toThrow('timed out after 30 seconds')
})

test('mapping budgets reject decoded expansion before constructing SourceMapConsumer', async () => {
  const sourceMap = require('source-map')
  const constructor = jest.spyOn(sourceMap, 'SourceMapConsumer')
  const leaf = {version: 3, sources: ['x.ts'], names: [], mappings: 'AAAA,AAAA'}
  try {
    await expect(
      importJavaScriptSourceMapSymbolRemapper(JSON.stringify(leaf), 'x.map', {maxMappings: 1}),
    ).rejects.toThrow('exceeds 1 mappings')
    await expect(
      importJavaScriptSourceMapSymbolRemapper(
        JSON.stringify({
          version: 3,
          sections: [
            {offset: {line: 0, column: 0}, map: leaf},
            {offset: {line: 1, column: 0}, map: leaf},
          ],
        }),
        'x.map',
        {maxMappings: 3},
      ),
    ).rejects.toThrow('exceeds 3 mappings')
    await expect(
      importJavaScriptSourceMapSymbolRemapper(
        JSON.stringify({...leaf, mappings: 'A'.repeat(129)}),
        'x.map',
        {maxMappings: 100},
      ),
    ).rejects.toThrow('oversized VLQ')
    expect(constructor).not.toHaveBeenCalled()
  } finally {
    constructor.mockRestore()
  }
})

test('missing positions or unmatched URLs produce a clear no-change preview error', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 1, name: 'run', file: sourceURL}], 1)
  mockFetch
    .mockResolvedValueOnce(new Response('', {headers: {SourceMap: 'x.map'}}))
    .mockResolvedValueOnce(new Response(mapText))
  await expect(previewLinkedSourceMap([builder.build()], sourceURL, signal())).rejects.toThrow(
    'No frames match',
  )
})

test('preview yields to cancellation on the time budget before reaching 128 frames', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 300; i++)
    builder.appendSampleWithWeight(
      [{key: i, name: `minified-${i}`, file: sourceURL, line: 1, col: 1}],
      1,
    )
  const input = builder.build()
  let frameReads = 0
  for (const frame of input.getFrames())
    Object.defineProperty(frame, 'file', {
      get: () => {
        frameReads++
        return sourceURL
      },
    })
  mockFetch
    .mockResolvedValueOnce(new Response('', {headers: {SourceMap: 'x.map'}}))
    .mockResolvedValueOnce(new Response(mapText))
  let now = 0
  const clock = jest.spyOn(performance, 'now')
  clock.mockImplementation(() => (now += 10))
  const controller = new AbortController()
  let cancellation: ReturnType<typeof setTimeout> | undefined
  try {
    await expect(
      previewLinkedSourceMap([input], sourceURL, controller.signal, status => {
        if (status === 'Checking source mappings…')
          cancellation = setTimeout(() => controller.abort(), 0)
      }),
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(frameReads).toBeLessThanOrEqual(3)
    expect(input.getFrame(0)!.name).toBe('minified-0')
  } finally {
    if (cancellation !== undefined) clearTimeout(cancellation)
    clock.mockRestore()
  }
})
