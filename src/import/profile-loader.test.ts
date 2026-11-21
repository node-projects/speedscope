/** @jest-environment node */
import {
  importProfileBuffer,
  importProfileFile,
  shouldUseTraceWorker,
  wereSymbolsLoaded,
} from './profile-loader'
import {processTraceInWorker} from './trace-worker'
import {snapshotTransferables} from '../lib/profile-snapshot'
import {TraceWorkerRequest, TraceWorkerResponse} from './trace-worker-protocol'
import {exportProfileGroup} from '../lib/file-format'
import {importProfileGroupFromText} from './index'
import * as importerModule from './index'
import * as fs from 'fs'
import * as pako from 'pako'
import {Profile} from '../lib/profile'
import {perftools} from './profile.proto.js'
import {JAVA_DUMP_ZIP_LIMITS} from './java-thread-dump-zip'
import JSZip from 'jszip'
import {TEXT_STREAM_LIMITS} from './streaming-text-profile'

const json = JSON.stringify([
  {ph: 'X', name: 'outer', pid: 'process', tid: 'thread', ts: 10, dur: 10},
  {ph: 'X', name: 'inner', pid: 'process', tid: 'thread', ts: 12, dur: 3},
])
const buffer = () => new TextEncoder().encode(json + ' '.repeat(1024 * 1024)).buffer as ArrayBuffer

class FakeWorker {
  onmessage: ((event: MessageEvent<TraceWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  terminate = jest.fn()
  postMessage(request: TraceWorkerRequest, transfers: ArrayBuffer[]) {
    const copy = structuredClone(request, {transfer: transfers})
    processTraceInWorker(
      copy,
      phase =>
        this.onmessage?.({data: {type: 'progress', phase}} as MessageEvent<TraceWorkerResponse>),
    )
      .then(response => {
        const transfer =
          response.type === 'result'
            ? snapshotTransferables(response.group)
            : response.type === 'fallback' && response.buffer
              ? [response.buffer]
              : []
        this.onmessage?.({
          data: structuredClone(response, {transfer}),
        } as MessageEvent<TraceWorkerResponse>)
      })
      .catch(
        error =>
          this.onmessage?.({
            data: {type: 'error', message: error.message},
          } as MessageEvent<TraceWorkerResponse>),
      )
  }
}
const factory = (worker: FakeWorker) => () => worker as unknown as Worker

test('large JSON imports transfer bytes, preserve exported profiles and terminate their worker', async () => {
  const worker = new FakeWorker()
  const input = buffer()
  const group = await importProfileBuffer('large.trace.json', input, {
    workerFactory: factory(worker),
  })
  expect(input.byteLength).toBe(0)
  const expected = await importProfileGroupFromText('large.trace.json', json)
  expect(exportProfileGroup(group!)).toEqual(exportProfileGroup(expected!))
  expect(wereSymbolsLoaded(group!)).toBe(true)
  expect(group!.sourceName).toBe('large.trace.json')
  expect(worker.terminate).toHaveBeenCalled()
})

test('normal imports retain the current leaf filename without exporting it', async () => {
  const group = await importProfileBuffer(
    'C:\\private\\session.json',
    new TextEncoder().encode(
      JSON.stringify({
        $schema: 'https://www.speedscope.app/file-format-schema.json',
        name: 'internal recording',
        shared: {frames: [{name: 'thread function'}]},
        profiles: [
          {
            name: 'Worker A',
            type: 'sampled',
            unit: 'none',
            startValue: 0,
            endValue: 1,
            samples: [[0]],
            weights: [1],
          },
        ],
      }),
    ).buffer as ArrayBuffer,
    {},
    false,
  )
  expect(group!.sourceName).toBe('session.json')
  expect(group!.name).toBe('internal recording')
  expect(group!.profiles[0].getName()).toBe('Worker A')
  expect(JSON.stringify(exportProfileGroup(group!))).not.toContain('sourceName')
})

test('worker creation blocked by the host falls back without detaching input', async () => {
  const input = buffer()
  const group = await importProfileBuffer('large.json', input, {
    workerFactory: () => {
      throw new Error('CSP')
    },
  })
  expect(group!.profiles[0].getTotalWeight()).toBe(10)
  expect(input.byteLength).toBeGreaterThan(0)
})

test('small ZIP main-thread imports retain cancellable Parsing progress and honor abort', async () => {
  const archive = new JSZip()
  archive.file(
    'snapshot.jstack',
    fs.readFileSync('sample/profiles/java-thread-dump/synthetic.jstack'),
  )
  const input = await archive.generateAsync({type: 'arraybuffer', compression: 'DEFLATE'})
  expect(input.byteLength).toBeLessThan(1024 * 1024)
  const controller = new AbortController()
  const workerFactory = jest.fn(() => {
    throw new Error('Small ZIP must not need a worker')
  })
  const onProgress = jest.fn((update: {phase: string; canCancel: boolean}) => {
    if (update.phase === 'Parsing profile' && update.canCancel) controller.abort()
  })
  await expect(
    importProfileBuffer('small.zip', input, {
      signal: controller.signal,
      onProgress,
      workerFactory,
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(workerFactory).not.toHaveBeenCalled()
  expect(onProgress).toHaveBeenCalledWith({phase: 'Parsing profile', canCancel: true})
  expect(input.byteLength).toBeGreaterThan(0)
})

test('small compressed folded Files and buffers stream without generic full-input parsing', async () => {
  const text = 'main;work 1\n'.repeat(100_000)
  const input = new Uint8Array(pako.gzip(text)).buffer as ArrayBuffer
  expect(input.byteLength).toBeLessThan(1024 * 1024)
  const workerFactory = jest.fn(() => {
    throw new Error('Compressed input is below worker threshold')
  })
  const generic = jest.spyOn(importerModule, 'importProfilesFromArrayBuffer')
  const file = new File([input], 'small.folded.gz')
  const fullRead = jest.spyOn(file, 'arrayBuffer')
  try {
    const fromFile = await importProfileFile(file, {workerFactory})
    const fromBuffer = await importProfileBuffer(file.name, input, {workerFactory})
    expect(fromFile!.profiles[0].getTotalWeight()).toBe(100_000)
    expect(exportProfileGroup(fromBuffer!)).toEqual(exportProfileGroup(fromFile!))
    expect(wereSymbolsLoaded(fromFile!)).toBe(false)
    expect(fullRead).not.toHaveBeenCalled()
    expect(generic).not.toHaveBeenCalled()
    expect(workerFactory).not.toHaveBeenCalled()
    expect(input.byteLength).toBeGreaterThan(0)
  } finally {
    generic.mockRestore()
  }
})

test('main-thread compressed text yields so a scheduled cancellation can run', async () => {
  const input = new Uint8Array(pako.gzip('main;work 1\n'.repeat(100_000))).buffer as ArrayBuffer
  const controller = new AbortController()
  const clock = jest.spyOn(performance, 'now')
  let now = 0,
    updates = 0
  clock.mockImplementation(() => (now += 20))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await expect(
      importProfileBuffer('small.folded.gz', input, {
        signal: controller.signal,
        onProgress: update => {
          if (update.phase === 'Streaming profile' && ++updates === 2)
            timer = setTimeout(() => controller.abort(), 0)
        },
      }),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(controller.signal.aborted).toBe(true)
    expect(updates).toBeGreaterThanOrEqual(2)
  } finally {
    if (timer) clearTimeout(timer)
    clock.mockRestore()
  }
})

test('main-thread text resource errors do not retry by fully materializing the input', async () => {
  const input = new Uint8Array(pako.gzip(' '.repeat(TEXT_STREAM_LIMITS.maxLineChars + 1)))
    .buffer as ArrayBuffer
  const file = new File([input], 'space.folded.gz')
  const fullRead = jest.spyOn(file, 'arrayBuffer')
  const generic = jest.spyOn(importerModule, 'importProfilesFromArrayBuffer')
  try {
    await expect(importProfileFile(file)).rejects.toThrow('line size')
    expect(fullRead).not.toHaveBeenCalled()
    expect(generic).not.toHaveBeenCalled()
  } finally {
    generic.mockRestore()
  }
})

test('unrecognized worker input returns its original buffer for normal detection', async () => {
  const response = await processTraceInWorker(
    {name: 'unknown.trace', input: new TextEncoder().encode('not a profile').buffer as ArrayBuffer},
    () => {},
  )
  expect(response.type).toBe('fallback')
  if (response.type === 'fallback')
    expect(new TextDecoder().decode(response.buffer)).toBe('not a profile')
})

test('cancellation before posting a buffer terminates the worker rather than leaving a pending promise', async () => {
  const controller = new AbortController()
  const worker = new FakeWorker()
  await expect(
    importProfileBuffer('large.json', buffer(), {
      workerFactory: factory(worker),
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(worker.terminate).toHaveBeenCalled()
})

test('worker errors settle the import, and native .cpuprofile/.heapprofile files are eligible', async () => {
  const worker = new FakeWorker()
  worker.postMessage = () => worker.onerror?.()
  await expect(
    importProfileBuffer('large.json', buffer(), {workerFactory: factory(worker)}),
  ).rejects.toThrow('stopped unexpectedly')
  expect(worker.terminate).toHaveBeenCalled()
  expect(shouldUseTraceWorker('large.cpuprofile', 2 ** 20)).toBe(true)
  expect(shouldUseTraceWorker('large.heapprofile', 2 ** 20)).toBe(true)
  expect(shouldUseTraceWorker('tiny.json', 10)).toBe(false)
  expect(shouldUseTraceWorker('large.txt', 2 ** 25)).toBe(true)
})

test('all large inputs use worker detection regardless of extension', () => {
  for (const name of [
    'capture.linux-perf.txt',
    'stacks.collapsed',
    'dump.jstack',
    'recording.jfr',
    'heap.pprof',
    'callgrind.out',
    'renamed',
    'unknown.bin.gz',
  ]) {
    expect(shouldUseTraceWorker(name, 1024 * 1024)).toBe(true)
    expect(shouldUseTraceWorker(name, 1024 * 1024 - 1)).toBe(false)
  }
})

test('large renamed folded input transfers ownership and retains cancellable worker progress', async () => {
  const text = 'main;work 1\n'.repeat(100_000)
  const input = new TextEncoder().encode(text).buffer as ArrayBuffer
  const worker = new FakeWorker()
  const progress = jest.fn()
  const group = await importProfileBuffer('renamed-recording', input, {
    workerFactory: factory(worker),
    onProgress: progress,
  })
  expect(input.byteLength).toBe(0)
  expect(group!.profiles[0].getTotalWeight()).toBe(100_000)
  expect([...group!.profiles[0].getFrames()].map(frame => frame.name)).toEqual(['main', 'work'])
  expect(wereSymbolsLoaded(group!)).toBe(true)
  expect(progress.mock.calls.some(([value]) => value.phase === 'Parsing profile')).toBe(true)
  expect(progress.mock.calls.every(([value]) => value.canCancel)).toBe(true)
  expect(worker.terminate).toHaveBeenCalled()
})

test('generic worker processing preserves perf, Java text, JFR and pprof fixture exports', async () => {
  const fixtures = [
    ['sample/profiles/linux-perf/leaf-only.linux-perf.txt', 'renamed-perf'],
    ['sample/profiles/java-thread-dump/synthetic.jstack', 'renamed-dump'],
    ['sample/profiles/java-flight-recorder/heavy.jfr', 'renamed-jfr'],
    ['sample/profiles/pprof/simple.prof', 'renamed-pprof'],
  ]
  for (const [path, name] of fixtures) {
    const input = new Uint8Array(fs.readFileSync(path)).buffer as ArrayBuffer
    const expected = await importerModule.importProfilesFromArrayBuffer(name, input)
    const response = await processTraceInWorker({name, input}, () => {})
    expect(response.type).toBe('result')
    if (response.type !== 'result') throw new Error('Expected worker fixture result')
    const transferred = structuredClone(response.group, {
      transfer: snapshotTransferables(response.group),
    })
    const profiles: Profile[] = []
    for (const snapshot of transferred.profiles) profiles.push(await Profile.fromSnapshot(snapshot))
    expect(exportProfileGroup({...transferred, profiles})).toEqual(exportProfileGroup(expected!))
  }
})

test('large binary pprof input uses the worker instead of extension-based main-thread parsing', async () => {
  const input = perftools.profiles.Profile.encode({
    stringTable: ['', 'samples', 'count', 'work', 'unused'.repeat(220_000)],
    sampleType: [{type: 1, unit: 2}],
    function: [{id: 1, name: 3}],
    location: [{id: 1, line: [{functionId: 1}]}],
    sample: [{locationId: [1], value: [7]}],
  }).finish().buffer as ArrayBuffer
  expect(input.byteLength).toBeGreaterThanOrEqual(1024 * 1024)
  const worker = new FakeWorker()
  const group = await importProfileBuffer('profile.bin', input, {workerFactory: factory(worker)})
  expect(input.byteLength).toBe(0)
  expect(group!.profiles[0].getTotalWeight()).toBe(7)
  expect([...group!.profiles[0].getFrames()].map(frame => frame.name)).toEqual(['work'])
})

test('large folded Files stream without materializing a whole input buffer', async () => {
  const file = new File(['main;work 1\n'.repeat(100_000)], 'large.collapsed')
  const read = jest.spyOn(file, 'arrayBuffer')
  const stream = jest.spyOn(file, 'stream')
  const response = await processTraceInWorker({name: file.name, input: file}, () => {})
  expect(response.type).toBe('result')
  expect(read).not.toHaveBeenCalled()
  expect(stream).toHaveBeenCalledTimes(1)
})

test('oversized renamed ZIP Files fail before worker streaming or full-buffer reads', async () => {
  const prefix = new Blob([new Uint8Array([0x50, 0x4b, 3, 4])])
  const input = {
    name: 'renamed-recording',
    size: JAVA_DUMP_ZIP_LIMITS.maxCompressedBytes + 1,
    slice: jest.fn(() => prefix),
    arrayBuffer: jest.fn(() => Promise.reject(new Error('Do not materialize oversized ZIP'))),
    stream: jest.fn(() => {
      throw new Error('Do not open oversized ZIP stream')
    }),
  }
  await expect(
    processTraceInWorker({name: input.name, input: input as unknown as File}, () => {}),
  ).rejects.toThrow('compressed input exceeds its limit')
  expect(input.slice).toHaveBeenCalledWith(0, 4)
  expect(input.arrayBuffer).not.toHaveBeenCalled()
  expect(input.stream).not.toHaveBeenCalled()
})

test('gzip generic worker formats decompress once and preserve observations', async () => {
  const nativeDecompression = DecompressionStream
  const decompress = jest.spyOn(globalThis, 'DecompressionStream')
  decompress.mockImplementation(format => new nativeDecompression(format))
  try {
    const input = new Uint8Array(
      pako.gzip(fs.readFileSync('sample/profiles/java-thread-dump/synthetic.jstack')),
    ).buffer as ArrayBuffer
    const response = await processTraceInWorker({name: 'capture.jstack.gz', input}, () => {})
    expect(response.type).toBe('result')
    if (response.type === 'result')
      expect(response.group.profiles.map(profile => profile.totalWeight)).toEqual([2, 2, 1])
    expect(decompress).toHaveBeenCalledTimes(1)
    expect(decompress).toHaveBeenCalledWith('gzip')
  } finally {
    decompress.mockRestore()
  }
})

test('DOM-dependent generic fallback returns transferred bytes before main-thread retry', async () => {
  const text = 'main;work 1\n'.repeat(100_000)
  const input = new TextEncoder().encode(text).buffer as ArrayBuffer
  const parse = jest.spyOn(importerModule, 'importProfilesFromArrayBuffer')
  parse.mockRejectedValueOnce(new ReferenceError('DOMParser is not defined'))
  const worker = new FakeWorker()
  try {
    const group = await importProfileBuffer('renamed-input', input, {
      workerFactory: factory(worker),
    })
    expect(input.byteLength).toBe(0)
    expect(group!.profiles[0].getTotalWeight()).toBe(100_000)
    expect(parse).toHaveBeenCalledTimes(2)
    expect(wereSymbolsLoaded(group!)).toBe(false)
    expect(worker.terminate).toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
})

test('a worker cannot silently fall back to a detached input buffer', async () => {
  const worker = new FakeWorker()
  worker.postMessage = (request, transfers) => {
    structuredClone(request, {transfer: transfers})
    worker.onmessage?.({data: {type: 'fallback'}} as MessageEvent<TraceWorkerResponse>)
  }
  await expect(
    importProfileBuffer('capture.bin', buffer(), {workerFactory: factory(worker)}),
  ).rejects.toThrow('return ownership')
  expect(worker.terminate).toHaveBeenCalled()
})

test('cancellation while a non-JSON worker begins parsing rejects and terminates it', async () => {
  const controller = new AbortController()
  const worker = new FakeWorker()
  const input = new TextEncoder().encode('main;work 1\n'.repeat(100_000)).buffer as ArrayBuffer
  await expect(
    importProfileBuffer('renamed-recording', input, {
      workerFactory: factory(worker),
      signal: controller.signal,
      onProgress: progress => {
        if (progress.phase === 'Parsing profile') controller.abort()
      },
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(worker.terminate).toHaveBeenCalled()
  expect(input.byteLength).toBe(0)
})

test('File imports can return original bytes for the normal detector', async () => {
  const worker = new FakeWorker()
  // A native File can be reread; no FileReader is needed in this returned-buffer case.
  const file = new File([buffer()], 'large.json')
  const original = await processTraceInWorker({name: file.name, input: file}, () => {})
  expect(original.type).toBe('result')
  // Avoid a Node-only FileReader fallback by returning the original bytes.
  worker.postMessage = request => {
    const inputFile = request.input as File
    void inputFile.arrayBuffer().then(
      bytes =>
        worker.onmessage?.({
          data: {type: 'fallback', buffer: bytes},
        } as MessageEvent<TraceWorkerResponse>),
    )
  }
  expect(
    (await importProfileFile(file, {workerFactory: factory(worker)}))!.profiles[0].getTotalWeight(),
  ).toBe(10)
})
