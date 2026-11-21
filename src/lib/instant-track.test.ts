/** @jest-environment node */
import * as instantModel from './instant-track'
import {
  InstantTrack,
  INSTANT_LIMITS,
  importInstantTracks,
  validateInstantTracks,
  hydrateInstantTracks,
  exportInstantTracks,
  validateInstantEventOmission,
  InstantEventResourceLimitError,
} from './instant-track'
import {FileFormat} from './file-format-spec'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {exportProfileGroupToBlob, ExportProgress} from './profile-export'
import {snapshotTransferables} from './profile-snapshot'
import {processTraceInWorker} from '../import/trace-worker'
import {importProfileBuffer} from '../import/profile-loader'

function track(changes: Partial<InstantTrack> = {}): InstantTrack {
  return {
    id: 'instant:1',
    name: 'Thread marks',
    clock: 'trace-event:wall',
    timeUnit: 'microseconds',
    start: 1e15,
    scope: 'thread',
    processId: '42',
    threadId: '7',
    times: new Float64Array([0, 2, 2, 5]),
    events: [
      {name: 'start', category: 'request', details: 'plain "text"\n<script>no execution</script>'},
      {name: 'same-time-first'},
      {name: 'same-time-second'},
      {name: 'end'},
    ],
    ...changes,
  }
}
function file(): FileFormat.File {
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {frames: []},
    profiles: [],
    instantTracks: exportInstantTracks([track()]),
  }
}
test('native/model metadata is stripped copied frozen and equal-time observations remain distinct', async () => {
  const source = track() as any
  source.events[0].extra = {unbounded: 'not retained'}
  const result = validateInstantTracks([source])!
  expect(result[0].times).toBe(source.times)
  expect(result[0].events).not.toBe(source.events)
  expect(result[0].events[0]).not.toHaveProperty('extra')
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result[0])).toBe(true)
  expect(Object.isFrozen(result[0].events)).toBe(true)
  expect(Object.isFrozen(result[0].events[0])).toBe(true)
  source.events[0].name = 'changed'
  expect(result[0].events[0].name).toBe('start')
  expect(result[0].events.slice(1, 3).map(info => info.name)).toEqual([
    'same-time-first',
    'same-time-second',
  ])
  const reused = await hydrateInstantTracks(result)
  expect(reused![0].times).toBe(result[0].times)
  expect(reused![0].events).toBe(result[0].events)
  expect(reused![0].events[0]).toBe(result[0].events[0])
  const native = exportInstantTracks(result)!
  const restored = importInstantTracks(native)!
  expect(restored[0].times).not.toBe(result[0].times)
  expect(Array.from(restored[0].times)).toEqual([0, 2, 2, 5])
  expect(restored[0].events[0].details).toBe(result[0].events[0].details)
})

test('instant-only native object and Blob export preserve point data without stack frames or durations', async () => {
  const group = importSpeedscopeProfiles(file())
  expect(group.profiles).toHaveLength(0)
  expect(group.counterTracks).toBeUndefined()
  const hydration = jest.spyOn(instantModel, 'hydrateInstantTracks')
  const progress: ExportProgress[] = []
  try {
    const blob = await exportProfileGroupToBlob(group, {onProgress: p => progress.push(p)})
    expect(hydration.mock.calls[0][0]).toBe(group.instantTracks)
    const output = JSON.parse(await blob.text())
    expect(output).toEqual(exportProfileGroup(group))
    expect(output.shared.frames).toEqual([])
    expect(output.profiles).toEqual([])
    expect(exportProfileGroup(importSpeedscopeProfiles(output))).toEqual(output)
    expect(progress[progress.length - 1]).toMatchObject({
      instantPointsWritten: 4,
      instantTrackCount: 1,
      profileCount: 0,
    })
  } finally {
    hydration.mockRestore()
  }
})

test('snapshot transfer deduplicates buffers across point/counter tracks and hydrates without numeric copies', async () => {
  const times = new Float64Array([0, 2])
  const input = {
    name: 'transfer',
    indexToView: 0,
    profiles: [],
    instantTracks: validateInstantTracks([track({times, events: [{name: 'a'}, {name: 'b'}]})])!,
    counterTracks: [
      {
        id: 'c',
        name: 'c',
        clock: 'trace-event:wall',
        timeUnit: 'microseconds' as const,
        start: 1e15,
        valueUnit: 'unknown',
        times,
        values: times,
      },
    ],
  }
  const buffers = snapshotTransferables(input)
  expect(buffers).toHaveLength(1)
  const transferred = structuredClone(input, {transfer: buffers})
  expect(times.byteLength).toBe(0)
  const hydrated = (await hydrateInstantTracks(transferred.instantTracks))!
  expect(hydrated[0].times).toBe(transferred.instantTracks[0].times)
  expect(hydrated[0].events).not.toBe(transferred.instantTracks[0].events)
  expect(Object.isFrozen(hydrated[0].events[0])).toBe(true)
})

test('generic worker result and loader preserve instant-only native files and reject corrupt metadata', async () => {
  const response = await processTraceInWorker(
    {
      name: 'points.speedscope.json',
      input: new TextEncoder().encode(JSON.stringify(file())).buffer as ArrayBuffer,
    },
    () => {},
  )
  if (response.type !== 'result') throw new Error('Expected instant result')
  expect(response.group.profiles).toHaveLength(0)
  const worker: any = {
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    postMessage: () =>
      setTimeout(
        () =>
          worker.onmessage({
            data: structuredClone(response, {transfer: snapshotTransferables(response.group)}),
          }),
        0,
      ),
  }
  const loaded = await importProfileBuffer('large', new ArrayBuffer(1024 * 1024), {
    workerFactory: () => worker,
  })
  expect(loaded!.instantTracks![0].events[2].name).toBe('same-time-second')
  expect(Object.isFrozen(loaded!.instantTracks![0].events)).toBe(true)
  const bad: any = {
    name: 'bad',
    indexToView: 0,
    profiles: [],
    instantTracks: [track({scope: 'invalid' as any})],
  }
  const corrupt: any = {
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    postMessage: () => setTimeout(() => corrupt.onmessage({data: {type: 'result', group: bad}}), 0),
  }
  await expect(
    importProfileBuffer('bad', new ArrayBuffer(1024 * 1024), {workerFactory: () => corrupt}),
  ).rejects.toThrow('scope')
})

test('strict identities clock scopes text and timestamp dimensions reject malformed input', async () => {
  const invalid = [
    {id: ''},
    {name: ' x'},
    {clock: 'x\n'},
    {timeUnit: 'bytes'},
    {start: NaN},
    {scope: 'cpu'},
    {processId: null},
    {times: [0], events: [{name: 'x'}]},
    {times: new Float64Array([0]), events: []},
    {times: new Float64Array([1, 0]), events: [{name: 'x'}, {name: 'y'}]},
    {times: new Float64Array([-1]), events: [{name: 'x'}]},
    {times: new Float64Array([Infinity]), events: [{name: 'x'}]},
    {times: new Float64Array([0]), events: [null]},
    {times: new Float64Array([0]), events: [{name: 'x', details: 1}]},
  ]
  for (const changes of invalid) {
    const value = {...track(), ...changes} as unknown as InstantTrack
    expect(() => validateInstantTracks([value])).toThrow('Instant tracks')
    await expect(hydrateInstantTracks([value])).rejects.toThrow('Instant tracks')
  }
  expect(() => validateInstantTracks([track(), track()])).toThrow('duplicate')
  const native = file()
  native.instantTracks![0].times[0] = null as unknown as number
  expect(() => importSpeedscopeProfiles(native)).toThrow('finite')
  expect(importInstantTracks(undefined)).toBeUndefined()
  expect(validateInstantTracks([track({times: new Float64Array(), events: []})])).toHaveLength(1)
})

test('point track label detail aggregate-metadata and backing limits fail before unbounded retention', async () => {
  const empty = {times: new Float64Array(), events: []}
  expect(() =>
    validateInstantTracks(Array.from({length: 257}, (_, i) => track({...empty, id: String(i)}))),
  ).toThrow('track limit')
  const excessive = new Float64Array(INSTANT_LIMITS.points + 1)
  expect(() =>
    validateInstantTracks([track({times: excessive, events: new Array(excessive.length)})]),
  ).toThrow('point limit')
  expect(() => validateInstantTracks([track({name: 'x'.repeat(513)})])).toThrow('oversized')
  expect(() =>
    validateInstantTracks([
      track({times: new Float64Array([0]), events: [{name: 'x', details: 'd'.repeat(16385)}]}),
    ]),
  ).toThrow('oversized')
  const infos = Array.from({length: 257}, () => ({name: 'x', details: 'd'.repeat(16384)}))
  expect(() =>
    validateInstantTracks([track({times: new Float64Array(infos.length), events: infos})]),
  ).toThrow('metadata limit')
  const hidden = new Float64Array(new ArrayBuffer(INSTANT_LIMITS.backingBytes + 8), 0, 1)
  await expect(
    hydrateInstantTracks([track({times: hidden, events: [{name: 'x'}]})]),
  ).rejects.toThrow('backing storage')
  const allowed = new Float64Array(new ArrayBuffer(INSTANT_LIMITS.backingBytes), 0, 1)
  expect(
    validateInstantTracks([
      track({id: 'a', times: allowed, events: [{name: 'x'}]}),
      track({id: 'b', times: allowed, events: [{name: 'y'}]}),
    ]),
  ).toHaveLength(2)
})

test('owned metadata reuse still validates mutable timestamps and cooperative cancellation', async () => {
  const owned = validateInstantTracks([track()])!
  owned[0].times[1] = -1
  await expect(hydrateInstantTracks(owned)).rejects.toThrow('sorted')
  const data = track({
    times: Float64Array.from({length: 10000}, (_, i) => i),
    events: Array.from({length: 10000}, (_, i) => ({name: String(i)})),
  })
  const controller = new AbortController()
  controller.abort()
  await expect(hydrateInstantTracks([data], {signal: controller.signal})).rejects.toHaveProperty(
    'name',
    'AbortError',
  )
  const during = new AbortController()
  let yields = 0
  await expect(
    hydrateInstantTracks([data], {
      signal: during.signal,
      yieldControl: async () => {
        yields++
        during.abort()
      },
    }),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(yields).toBe(1)
})

test('chunked export yields and cancels across large event details without full numeric arrays', async () => {
  const owned = validateInstantTracks([
    track({
      times: Float64Array.from({length: 5000}, (_, i) => i),
      events: Array.from({length: 5000}, (_, i) => ({name: String(i), details: 'text'.repeat(10)})),
    }),
  ])!
  const controller = new AbortController()
  let turns = 0
  await expect(
    exportProfileGroupToBlob(
      {name: 'cancel', indexToView: 0, profiles: [], instantTracks: owned},
      {
        signal: controller.signal,
        yieldControl: async () => {
          if (++turns === 4) controller.abort()
        },
      },
    ),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(turns).toBe(4)
  expect(owned[0].times.byteLength).toBe(40000)
})

test('omission summaries strictly validate positive exact counts and reason codes, stripping extra metadata', () => {
  for (const reason of ['point-limit', 'track-limit', 'metadata-limit', 'details-limit'] as const) {
    const original = {count: 309230, reason, unknown: {large: 'not retained'}}
    const result = validateInstantEventOmission(original)!
    expect(result).toEqual({count: 309230, reason})
    expect(Object.isFrozen(result)).toBe(true)
    original.count = 1
    expect(result.count).toBe(309230)
  }
  expect(validateInstantEventOmission(undefined)).toBeUndefined()
  expect(
    validateInstantEventOmission({count: Number.MAX_SAFE_INTEGER, reason: 'point-limit'})!.count,
  ).toBe(Number.MAX_SAFE_INTEGER)
  for (const value of [
    null,
    [],
    {},
    {count: 0, reason: 'point-limit'},
    {count: -1, reason: 'point-limit'},
    {count: 0.5, reason: 'point-limit'},
    {count: Infinity, reason: 'point-limit'},
    {count: Number.MAX_SAFE_INTEGER + 1, reason: 'point-limit'},
    {count: '1', reason: 'point-limit'},
    {count: 1, reason: 'unknown'},
    {count: 1, reason: null},
  ])
    expect(() => validateInstantEventOmission(value)).toThrow('omission')
})

test('native worker object and chunked export preserve omission notices without retained instant data', async () => {
  const input = file()
  delete input.instantTracks
  input.name = 'mixed omission'
  input.instantEventOmission = {count: 309230, reason: 'point-limit'}
  input.counterTracks = [
    {
      id: 'counter',
      name: 'retained',
      clock: 'trace-event:wall',
      timeUnit: 'microseconds',
      start: 0,
      valueUnit: 'unknown',
      times: [0, 1],
      values: [2, 3],
    },
  ]
  const group = importSpeedscopeProfiles(input)
  expect(group.instantTracks).toBeUndefined()
  expect(group.instantEventOmission).toEqual(input.instantEventOmission)
  expect(Object.isFrozen(group.instantEventOmission)).toBe(true)
  const exported = exportProfileGroup(group)
  const blob = await exportProfileGroupToBlob(group)
  expect(JSON.parse(await blob.text())).toEqual(exported)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
  const response = await processTraceInWorker(
    {
      name: 'omission.speedscope.json',
      input: new TextEncoder().encode(JSON.stringify(input)).buffer as ArrayBuffer,
    },
    () => {},
  )
  if (response.type !== 'result') throw new Error('Expected omission result')
  expect(response.group.instantEventOmission).toEqual(input.instantEventOmission)
  const worker: any = {
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    postMessage: () =>
      setTimeout(
        () =>
          worker.onmessage({
            data: structuredClone(response, {transfer: snapshotTransferables(response.group)}),
          }),
        0,
      ),
  }
  const restored = await importProfileBuffer('large', new ArrayBuffer(1024 * 1024), {
    workerFactory: () => worker,
  })
  expect(restored!.instantEventOmission).toEqual(input.instantEventOmission)
  expect(Object.isFrozen(restored!.instantEventOmission)).toBe(true)
  expect(Array.from(restored!.counterTracks![0].values)).toEqual([2, 3])
  const inconsistent = {...file(), instantEventOmission: input.instantEventOmission}
  expect(() => importSpeedscopeProfiles(inconsistent)).toThrow('cannot accompany')
  expect(() =>
    importSpeedscopeProfiles({
      ...input,
      instantEventOmission: {count: 1, reason: 'invalid'},
    } as unknown as FileFormat.File),
  ).toThrow('omission')
  const invalidSummary: any = {
    ...response.group,
    instantEventOmission: {count: 0, reason: 'point-limit'},
  }
  const corrupt: any = {
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    postMessage: () =>
      setTimeout(() => corrupt.onmessage({data: {type: 'result', group: invalidSummary}}), 0),
  }
  await expect(
    importProfileBuffer('invalid-summary', new ArrayBuffer(1024 * 1024), {
      workerFactory: () => corrupt,
    }),
  ).rejects.toThrow('omission')
  await expect(
    exportProfileGroupToBlob({...group, instantTracks: validateInstantTracks([track()])}),
  ).rejects.toThrow('cannot accompany')
})

test('resource error codes are explicit and malformed metadata is not a recoverable resource error', () => {
  let failure: unknown
  try {
    validateInstantTracks([track({name: 'x'.repeat(513)})])
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(InstantEventResourceLimitError)
  expect((failure as InstantEventResourceLimitError).reason).toBe('metadata-limit')
  try {
    validateInstantTracks([track({name: ' '})])
  } catch (error) {
    failure = error
  }
  expect(failure).not.toBeInstanceOf(InstantEventResourceLimitError)
})
