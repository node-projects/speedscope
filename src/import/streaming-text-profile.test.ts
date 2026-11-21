/** @jest-environment node */
import * as fs from 'fs'
import * as zlib from 'zlib'
import {exportProfileGroup} from '../lib/file-format'
import {importProfilesFromArrayBuffer} from './index'
import {
  importTextProfileStream,
  tryImportTextProfile,
  TEXT_STREAM_LIMITS,
} from './streaming-text-profile'

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer
function source(input: ArrayBuffer, size = 7, cancelled = jest.fn()) {
  const data = new Uint8Array(input)
  let at = 0
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (at === data.length) controller.close()
      else {
        controller.enqueue(data.subarray(at, at + size))
        at = Math.min(data.length, at + size)
      }
    },
    cancel: cancelled,
  })
}

test('all perf fixtures preserve profiles, thread/counter identities and timestamp totals', async () => {
  for (const file of fs.readdirSync('sample/profiles/linux-perf')) {
    const input = new Uint8Array(fs.readFileSync(`sample/profiles/linux-perf/${file}`))
      .buffer as ArrayBuffer
    const expected = await importProfilesFromArrayBuffer(file, input)
    const actual = await importTextProfileStream(source(input), file, 'perf')
    expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
    expect(actual!.sourceName).toBe(expected!.sourceName)
  }
})

test('folded fixtures keep malformed-line tolerance, fractions, source labels and UTF-8', async () => {
  for (const file of fs
    .readdirSync('sample/profiles/stackcollapse')
    .filter(name => name.endsWith('.txt') && !name.includes('utf16'))) {
    const input = new Uint8Array(fs.readFileSync(`sample/profiles/stackcollapse/${file}`))
      .buffer as ArrayBuffer
    const expected = await importProfilesFromArrayBuffer(file, input)
    const actual = await importTextProfileStream(source(input, 3), file, 'folded')
    expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  }
  const input = bytes(
    '\ufeff# unicode\r\n[unknown];λ😀 1.5\r\n[unknown];日本語 2e1\r\ninvalid line\r\n[unknown];λ😀 .25',
  )
  const expected = await importProfilesFromArrayBuffer('unicode.folded', input)
  const actual = await importTextProfileStream(source(input, 1), 'unicode.folded', 'folded')
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
})

test('perf hybrids and raw counter periods remain distinct while streaming', async () => {
  const text = [
    'x 1 [000] 1.000000: 7 cpu_core/cycles/u:\n  100 work (/app)\n',
    'x 1 [001] 2.000000: 9 cpu_atom/cycles/u:\n  100 work (/app)\n',
    'x 1 [001] 3.000000: 11 instructions:\n  200 count (/app)\n',
    'x 2 [001] 4.000000: 13 instructions: 300 another (/app)\n',
  ].join('\n')
  const input = bytes(text),
    name = 'hybrid.linux-perf.txt'
  const expected = await importProfilesFromArrayBuffer(name, input)
  const actual = await importTextProfileStream(source(input, 1), name, 'perf')
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  expect(actual!.profiles.map(profile => profile.getTotalWeight())).toEqual([16, 11, 13])
})

test('deep folded stacks remain iterative and export the same source frames and weights', async () => {
  const depth = 30_000
  const input = bytes(Array.from({length: depth}, (_, i) => `frame${i}`).join(';') + ' 2\n')
  const name = 'deep.folded'
  const expected = await importProfilesFromArrayBuffer(name, input)
  const actual = await importTextProfileStream(source(input, 4096), name, 'folded')
  expect(actual!.profiles[0].getTotalWeight()).toBe(2)
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
})

test('plain and gzip Files stream once without arrayBuffer or whole-document decoder use', async () => {
  for (const gzip of [false, true]) {
    const input = bytes('main;work 1\n'.repeat(100_000))
    const file = new File(
      [gzip ? new Uint8Array(zlib.gzipSync(new Uint8Array(input))) : input],
      `capture.folded${gzip ? '.gz' : ''}`,
    )
    const fullRead = jest.spyOn(file, 'arrayBuffer')
    const open = jest.spyOn(file, 'stream')
    const Native = DecompressionStream
    const decompress = jest.spyOn(globalThis, 'DecompressionStream')
    decompress.mockImplementation(format => new Native(format))
    try {
      const group = await tryImportTextProfile(file, file.name)
      expect(group!.profiles[0].getTotalWeight()).toBe(100_000)
      expect(fullRead).not.toHaveBeenCalled()
      expect(open).toHaveBeenCalledTimes(1)
      expect(decompress).toHaveBeenCalledTimes(gzip ? 1 : 0)
    } finally {
      decompress.mockRestore()
    }
  }
})

test('gzip split at every compressed byte preserves multibyte text and CRLF', async () => {
  const input = bytes('main;λ😀 2\r\nmain;日本語 3\r\n')
  const gzip = new Uint8Array(zlib.gzipSync(new Uint8Array(input))).buffer as ArrayBuffer
  const actual = await importTextProfileStream(
    source(gzip, 1).pipeThrough(new DecompressionStream('gzip')),
    'split.folded.gz',
    'folded',
  )
  const expected = await importProfilesFromArrayBuffer('split.folded.gz', input)
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
})

test('auto text detects folded/perf and returns all original bytes for ambiguous or other formats', async () => {
  for (const text of ['main;work 1\n', 'x 1 1.000000: instructions: 100 work (/app)\n']) {
    const input = bytes(text)
    const group = await tryImportTextProfile(input, 'renamed.txt')
    expect(group).not.toBeNull()
    expect(group!.profiles[0].getWeightUnit()).toBe('none')
    expect(input.byteLength).toBe(new TextEncoder().encode(text).byteLength)
  }
  for (const text of [
    '{\n "count": 1\n}',
    'Full thread dump OpenJDK VM:\n',
    '# callgrind format\nevents: Ir\nfn=work\n1 3\n',
    'main;work 2\nx 1 1.000000: instructions: 100 leaf (/app)\n',
  ]) {
    const input = bytes(text),
      expected = input.slice(0)
    expect(await tryImportTextProfile(input, 'renamed.txt')).toBeNull()
    expect(new Uint8Array(input)).toEqual(new Uint8Array(expected))
  }
})

test('UTF-16 and unsupported suffix/native-gzip environments retain generic fallback', async () => {
  for (const file of ['simple-utf16-le.txt', 'simple-utf16-be.txt']) {
    const input = new Uint8Array(fs.readFileSync(`sample/profiles/stackcollapse/${file}`))
      .buffer as ArrayBuffer
    expect(await tryImportTextProfile(input, file)).toBeNull()
  }
  const file = new File(['main;work 1\n'], 'renamed.bin')
  const open = jest.spyOn(file, 'stream')
  expect(await tryImportTextProfile(file, file.name)).toBeNull()
  expect(open).not.toHaveBeenCalled()
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream')!
  Object.defineProperty(globalThis, 'DecompressionStream', {configurable: true, value: undefined})
  try {
    const input = new Uint8Array(zlib.gzipSync(new Uint8Array(bytes('main;work 1\n'))))
      .buffer as ArrayBuffer
    expect(await tryImportTextProfile(input, 'capture.folded.gz')).toBeNull()
    expect(input.byteLength).toBeGreaterThan(0)
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', descriptor)
  }
})

test('renamed minified JSON falls back before the pending-line cap or a full input scan', async () => {
  for (const text of [
    '{"name":"' + 'x'.repeat(2 * 1024 * 1024) + '"}',
    '[{"name":"' + 'x'.repeat(2 * 1024 * 1024) + '"}]',
  ]) {
    const input = bytes(text)
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(input, offset, 1))
        offset++
      },
    })
    expect(await importTextProfileStream(stream, 'renamed.txt', 'auto')).toBeNull()
    expect(offset).toBeLessThan(16)
    expect(input.byteLength).toBeGreaterThan(TEXT_STREAM_LIMITS.maxLineChars)
  }
})

test('byte, pending line, event, stack and sample limits stop without a partial result', async () => {
  const cases = [
    {text: 'main;work 1\n', kind: 'folded' as const, limits: {maxBytes: 4}},
    {text: ' '.repeat(50_000), kind: 'folded' as const, limits: {maxLineChars: 64}},
    {text: 'main;work;deep 1\n', kind: 'folded' as const, limits: {maxStackDepth: 2}},
    {text: 'main;work 1\nmain;other 1\n', kind: 'folded' as const, limits: {maxSamples: 1}},
    {
      text: 'x 1 1.000000: instructions:\n  100 work (/app)\n',
      kind: 'perf' as const,
      limits: {maxPerfEventChars: 16},
    },
    {
      text: 'x 1 1.000000: instructions:\n  100 work (/app)\n  200 root (/app)\n',
      kind: 'perf' as const,
      limits: {maxStackDepth: 1},
    },
  ]
  for (const value of cases) {
    const cancel = jest.fn()
    const stream = source(bytes(value.text), 7, cancel)
    await expect(
      importTextProfileStream(stream, 'limited.txt', value.kind, {
        limits: value.limits,
      }),
    ).rejects.toThrow('limit exceeded')
    expect(stream.locked).toBe(false)
  }
  await expect(
    importTextProfileStream(source(bytes('main 1\n')), 'x', 'folded', {limits: {maxBytes: 0}}),
  ).rejects.toThrow('Invalid text import limits')
})

test('late malformed weights and out-of-order perf timestamps never return a partial profile', async () => {
  await expect(
    importTextProfileStream(source(bytes('main;work 1\nmain;bad -2\n')), 'x', 'folded'),
  ).rejects.toThrow('non-negative')
  await expect(
    importTextProfileStream(source(bytes('main;work 1\nmain;bad 1e999\n')), 'x', 'folded'),
  ).rejects.toThrow('finite')
  const perf = 'x 1 2.000000: cycles: 100 work (/app)\nx 1 1.000000: cycles: 200 late (/app)\n'
  await expect(importTextProfileStream(source(bytes(perf)), 'x', 'perf')).rejects.toThrow(
    'out of order',
  )
  await expect(
    importTextProfileStream(
      source(bytes(`x 1 1.000000: ${'9'.repeat(400)} instructions: 100 work (/app)\n`)),
      'x',
      'perf',
    ),
  ).rejects.toThrow('finite')
  await expect(
    tryImportTextProfile(new Uint8Array([0x1f, 0x8b, 0, 0]).buffer, 'x.folded.gz'),
  ).rejects.toThrow()
})

test('abort cancels an in-flight reader and does not wait for a hostile cancellation hook', async () => {
  const controller = new AbortController(),
    cancel = jest.fn(() => new Promise<void>(() => {}))
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      value.enqueue(new TextEncoder().encode('main;work 1\n'))
    },
    cancel,
  })
  const pending = importTextProfileStream(stream, 'x', 'folded', {signal: controller.signal})
  setTimeout(() => controller.abort(), 0)
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  expect(cancel).toHaveBeenCalledTimes(1)
})

test('explicit worker context skips timer yields while preserving streamed totals and progress', async () => {
  const clock = jest.spyOn(performance, 'now')
  let now = 0
  clock.mockImplementation(() => (now += 20))
  const timers = jest.spyOn(globalThis, 'setTimeout')
  const progress = jest.fn()
  try {
    const group = await importTextProfileStream(
      source(bytes('main;work 1\n'.repeat(100_000)), 65536),
      'worker.folded',
      'folded',
      {
        yieldToMainThread: false,
        signal: new AbortController().signal,
        onProgress: progress,
      },
    )
    expect(group!.profiles[0].getTotalWeight()).toBe(100_000)
    expect(progress).toHaveBeenCalledWith(1_200_000)
    expect(timers).not.toHaveBeenCalled()
  } finally {
    timers.mockRestore()
    clock.mockRestore()
  }
})

test('one giant source chunk is decoded in bounded pieces and limits apply to expanded gzip bytes', async () => {
  const input = bytes('main;work 1\n'.repeat(100_000))
  const decode = jest.spyOn(TextDecoder.prototype, 'decode')
  try {
    const group = await importTextProfileStream(source(input, input.byteLength), 'x', 'folded')
    expect(group!.profiles[0].getTotalWeight()).toBe(100_000)
    for (const [piece] of decode.mock.calls)
      if (piece) expect((piece as Uint8Array).byteLength).toBeLessThanOrEqual(65536)
  } finally {
    decode.mockRestore()
  }
  const gzip = new Uint8Array(zlib.gzipSync(new Uint8Array(input))).buffer as ArrayBuffer
  await expect(
    tryImportTextProfile(gzip, 'x.folded.gz', {limits: {maxBytes: 1024}}),
  ).rejects.toThrow('expanded byte count')
  expect(TEXT_STREAM_LIMITS.maxLineChars).toBeLessThan(TEXT_STREAM_LIMITS.maxBytes)
})
