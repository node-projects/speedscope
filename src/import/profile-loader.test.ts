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
  expect(worker.terminate).toHaveBeenCalled()
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
  expect(shouldUseTraceWorker('large.txt', 2 ** 25)).toBe(false)
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
