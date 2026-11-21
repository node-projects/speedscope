/** @jest-environment node */
import {
  CounterTrack,
  COUNTER_LIMITS,
  exportCounterTracks,
  hydrateCounterTracks,
  importCounterTracks,
  validateCounterTracks,
} from './counter-track'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {exportProfileGroupToBlob, ExportProgress} from './profile-export'
import {FileFormat} from './file-format-spec'
import {snapshotTransferables} from './profile-snapshot'
import {processTraceInWorker} from '../import/trace-worker'
import {importProfileBuffer} from '../import/profile-loader'

function track(changes: Partial<CounterTrack> = {}): CounterTrack {
  return {
    id: 'counter:1',
    name: 'heap / used',
    clock: 'trace-event:wall',
    timeUnit: 'microseconds',
    start: 1e15,
    valueUnit: 'bytes',
    processId: '42',
    threadId: '7',
    category: 'memory',
    times: new Float64Array([0, 2, 2, 5]),
    values: new Float64Array([1, -2, 4, 3]),
    ...changes,
  }
}
function file(): FileFormat.File {
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {frames: []},
    profiles: [],
    counterTracks: exportCounterTracks([track()]),
  }
}
test('independent counter series preserves gauge values and stable duplicate timestamps without stack frames', () => {
  const original = track()
  const validated = validateCounterTracks([original])!
  expect(validated[0]).not.toBe(original)
  expect(validated[0].times).toBe(original.times)
  expect(validated[0].values).toBe(original.values)
  const native = exportCounterTracks(validated)!
  expect(native[0].values).toEqual([1, -2, 4, 3])
  const restored = importCounterTracks(native)!
  expect(restored[0].times).not.toBe(original.times)
  expect(Array.from(restored[0].times)).toEqual([0, 2, 2, 5])
  expect(restored[0]).toMatchObject({
    clock: 'trace-event:wall',
    start: 1e15,
    valueUnit: 'bytes',
    processId: '42',
    threadId: '7',
  })
  expect(importCounterTracks(undefined)).toBeUndefined()
  expect(
    validateCounterTracks([track({times: new Float64Array(), values: new Float64Array()})]),
  ).toHaveLength(1)
})

test('counter-only native object and chunked export roundtrip without a synthetic stack profile', async () => {
  const input = file(),
    group = importSpeedscopeProfiles(input)
  expect(group.profiles).toHaveLength(0)
  expect(group.counterTracks).toHaveLength(1)
  expect(group.name).toBe('profile')
  const progress: ExportProgress[] = []
  const blob = await exportProfileGroupToBlob(group, {onProgress: p => progress.push(p)})
  const output = JSON.parse(await blob.text())
  expect(output).toEqual(exportProfileGroup(group))
  expect(output.shared.frames).toEqual([])
  expect(exportProfileGroup(importSpeedscopeProfiles(output))).toEqual(output)
  expect(progress[progress.length - 1]).toMatchObject({
    counterSamplesWritten: 4,
    counterCount: 1,
    profilesCompleted: 0,
  })
})

test('snapshot transfer deduplicates shared numeric buffers and preserves receiving ownership', async () => {
  const numbers = new Float64Array([0, 2, 2, 5])
  const group = {
    name: 'shared',
    indexToView: 0,
    profiles: [],
    counterTracks: [track({times: numbers, values: numbers})],
  }
  const buffers = snapshotTransferables(group)
  expect(buffers).toHaveLength(1)
  const copy = structuredClone(group, {transfer: buffers})
  expect(numbers.byteLength).toBe(0)
  const validated = await hydrateCounterTracks(copy.counterTracks)
  expect(validated![0].times).toBe(copy.counterTracks[0].times)
  expect(validated![0].times.buffer).toBe(validated![0].values.buffer)
})

test('generic worker result and loader hydrate counter-only files with typed transfer arrays', async () => {
  const input = new TextEncoder().encode(JSON.stringify(file())).buffer as ArrayBuffer
  const response = await processTraceInWorker({name: 'counters.speedscope.json', input}, () => {})
  expect(response.type).toBe('result')
  if (response.type !== 'result') throw new Error('Expected counters')
  expect(response.group.profiles).toHaveLength(0)
  expect(response.group.counterTracks![0].times).toBeInstanceOf(Float64Array)
  const terminate = jest.fn()
  const worker: any = {
    terminate,
    onmessage: null,
    onerror: null,
    postMessage: () => {
      const transferred = structuredClone(response, {
        transfer: snapshotTransferables(response.group),
      })
      setTimeout(() => worker.onmessage({data: transferred}), 0)
    },
  }
  const loaded = await importProfileBuffer('large.speedscope.json', new ArrayBuffer(1024 * 1024), {
    workerFactory: () => worker,
  })
  expect(loaded!.profiles).toHaveLength(0)
  expect(loaded!.counterTracks![0].values).toEqual(new Float64Array([1, -2, 4, 3]))
  expect(terminate).toHaveBeenCalled()
})

test('strict native/model validation rejects malformed labels identities clock fields and numeric data', async () => {
  const invalid = [
    {id: ''},
    {name: ' x'},
    {clock: 'x\n'},
    {valueUnit: ''},
    {timeUnit: 'bytes'},
    {start: NaN},
    {start: Infinity},
    {processId: null},
    {times: [0], values: [1]},
    {times: new Float64Array([0]), values: new Float64Array([1, 2])},
    {times: new Float64Array([1, 0]), values: new Float64Array([1, 2])},
    {times: new Float64Array([-1]), values: new Float64Array([1])},
    {times: new Float64Array([NaN]), values: new Float64Array([1])},
    {times: new Float64Array([0]), values: new Float64Array([Infinity])},
  ]
  for (const changes of invalid) {
    const bad = {...track(), ...changes} as unknown as CounterTrack
    expect(() => validateCounterTracks([bad])).toThrow('Counter tracks')
    await expect(hydrateCounterTracks([bad])).rejects.toThrow('Counter tracks')
  }
  expect(() => validateCounterTracks([track(), track()])).toThrow('duplicate')
  const badNative = file()
  badNative.counterTracks![0].times = [null as unknown as number]
  badNative.counterTracks![0].values = [1]
  expect(() => importSpeedscopeProfiles(badNative)).toThrow('finite')
})

test('caps track count, declared sample dimensions and label retention before sample loops', () => {
  const empty = {times: new Float64Array(), values: new Float64Array()}
  expect(() =>
    validateCounterTracks(
      Array.from({length: COUNTER_LIMITS.tracks + 1}, (_, i) => track({...empty, id: String(i)})),
    ),
  ).toThrow('series limit')
  const large = new Float64Array(COUNTER_LIMITS.samplesPerTrack + 1)
  expect(() => validateCounterTracks([track({times: large, values: large})])).toThrow(
    'sample count',
  )
  const million = new Float64Array(COUNTER_LIMITS.samplesPerTrack)
  expect(() =>
    validateCounterTracks([
      track({id: 'a', times: million, values: million}),
      track({id: 'b', times: million, values: million}),
      track({id: 'c'}),
    ]),
  ).toThrow('sample count')
  expect(() =>
    validateCounterTracks([track({name: 'x'.repeat(COUNTER_LIMITS.labelCharacters + 1)})]),
  ).toThrow('label')
  expect(() =>
    validateCounterTracks(
      Array.from({length: COUNTER_LIMITS.tracks}, (_, i) =>
        track({...empty, id: String(i), name: 'x'.repeat(512)}),
      ),
    ),
  ).toThrow('label limit')
})

test('chunked counter export yields/cancels without constructing whole number arrays', async () => {
  const count = 100000
  const times = Float64Array.from({length: count}, (_, i) => i)
  const values = Float64Array.from({length: count}, (_, i) => Math.sin(i))
  const original = track({times, values})
  const controller = new AbortController()
  let turns = 0
  const promise = exportProfileGroupToBlob(
    {name: 'large', indexToView: 0, profiles: [], counterTracks: [original]},
    {
      signal: controller.signal,
      yieldControl: async () => {
        if (++turns === 3) controller.abort()
      },
    },
  )
  await expect(promise).rejects.toHaveProperty('name', 'AbortError')
  expect(turns).toBe(3)
  expect(original.times.byteLength).toBe(count * 8)
})

test('backing byte budget rejects tiny views of oversized storage and deduplicates aliases', async () => {
  const oversized = new ArrayBuffer(COUNTER_LIMITS.backingBytes + 8)
  const tiny = new Float64Array(oversized, 0, 1)
  expect(() => validateCounterTracks([track({times: tiny, values: tiny})])).toThrow(
    'backing storage',
  )
  await expect(hydrateCounterTracks([track({times: tiny, values: tiny})])).rejects.toThrow(
    'backing storage',
  )
  const allowed = new ArrayBuffer(COUNTER_LIMITS.backingBytes)
  const view = new Float64Array(allowed, 0, 1)
  expect(validateCounterTracks([track({times: view, values: view})])![0].times).toBe(view)
  const second = new Float64Array(1)
  expect(() =>
    validateCounterTracks([
      track({times: view, values: view}),
      track({id: 'another', times: second, values: second}),
    ]),
  ).toThrow('backing storage')
})

test('worker hydration supports cancellation and rejects corrupt counter-only payloads', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(hydrateCounterTracks([track()], {signal: controller.signal})).rejects.toHaveProperty(
    'name',
    'AbortError',
  )
  const invalid: any = {
    name: 'invalid',
    indexToView: 0,
    profiles: [],
    counterTracks: [track({values: new Float64Array([Infinity, 0, 0, 0])})],
  }
  const worker: any = {
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    postMessage: () =>
      setTimeout(() => worker.onmessage({data: {type: 'result', group: invalid}}), 0),
  }
  await expect(
    importProfileBuffer('bad', new ArrayBuffer(1024 * 1024), {workerFactory: () => worker}),
  ).rejects.toThrow('finite values')
  expect(worker.terminate).toHaveBeenCalled()
})
