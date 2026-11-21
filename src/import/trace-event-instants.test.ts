/** @jest-environment node */
import fs from 'fs'
import {InstantEventResourceLimitError} from '../lib/instant-track'
import zlib from 'zlib'
import {importTraceInstantTracks, isChromeCPUProfileRecord} from './trace-event-instants'
import {importProfileGroupFromText} from './index'
import {importFromChromeTimeline} from './chrome'
import {tryImportDurationTrace, importDurationTraceStream} from './streaming-trace'
import {processTraceInWorker} from './trace-worker'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {snapshotTransferables} from '../lib/profile-snapshot'

const point = (extra: any = {}) => ({ph: 'i', name: 'point', ts: 10, ...extra})
const numeric = (tracks: ReturnType<typeof importTraceInstantTracks>) =>
  tracks.map(track => ({...track, times: Array.from(track.times)}))
const fixture = () => fs.readFileSync('sample/profiles/trace-event/instants.json', 'utf8')

test('instant phases retain scope, source clocks, equal timestamps and bounded raw details without stack weights', async () => {
  const group = (await importProfileGroupFromText('instants.json', fixture()))!
  expect(group.profiles).toHaveLength(1)
  expect(group.profiles[0].getTotalWeight()).toBe(20)
  expect(Array.from(group.profiles[0].getFrames())).toHaveLength(1)
  expect(group.counterTracks).toHaveLength(1)
  const tracks = numeric(group.instantTracks!)
  expect(tracks).toHaveLength(3)
  expect(tracks[0]).toMatchObject({
    scope: 'thread',
    clock: 'trace-event:wall',
    timeUnit: 'microseconds',
    start: 825.5,
    times: [0, 3.5],
    processId: '22630',
    threadId: '22630',
  })
  expect(tracks[0].events.map(event => event.name)).toEqual(['earlier', 'hi'])
  expect(JSON.parse(tracks[0].events[1].details!)).toMatchObject({
    stack: ['a', 'b', 'c'],
    pid: 22630,
    tid: 22630,
  })
  expect(tracks[1].scope).toBe('process')
  expect(tracks[1].processId).toBe('7')
  expect(tracks[1].threadId).toBeUndefined()
  expect(JSON.parse(tracks[1].events[0].details!).tid).toBe(99)
  expect(tracks[2].scope).toBe('global')
  expect(tracks[2].processId).toBeUndefined()
  expect(tracks[2].threadId).toBeUndefined()
  expect(tracks[2].times).toEqual([0, 0])
  expect(tracks[2].events.map(event => JSON.parse(event.details!).pid)).toEqual([1, 3])
  const exported = exportProfileGroup(group)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
})

test('upstream #402 exact instant-only example imports as a point at829 microseconds, not nanoseconds or sampled stacks', async () => {
  const text =
    '{"traceEvents":[{"name":"hi","cat":"none","ph":"i","pid":22630,"tid":22630,"ts":829,"stack":["a","b","c"]},],"displayTimeUnit":"ns","otherData":{"version":"none"},"samples":[]}'
  const group = (await importProfileGroupFromText('test.json', text))!
  expect(group.profiles).toEqual([])
  expect(group.instantTracks![0].start).toBe(829)
  expect(group.instantTracks![0].timeUnit).toBe('microseconds')
  expect(Array.from(group.instantTracks![0].times)).toEqual([0])
  expect(JSON.parse(group.instantTracks![0].events[0].details!).stack).toEqual(['a', 'b', 'c'])
  // Empty samples is an unsupported streaming root key, so the worker must
  // reopen the complete input through its bounded generic importer.
  const response = await processTraceInWorker(
    {name: 'test.json', input: new TextEncoder().encode(text).buffer as ArrayBuffer},
    () => {},
  )
  if (response.type !== 'result') throw new Error('Expected worker result')
  expect(response.group.profiles).toEqual([])
  expect(numeric(response.group.instantTracks!)).toEqual(numeric(group.instantTracks!))
})

test('typed lane identities separate processes and threads but ignore irrelevant global/process IDs', () => {
  const tracks = importTraceInstantTracks([
    point({pid: 1, tid: 1}),
    point({pid: '1', tid: 1}),
    point({pid: 1, tid: '1'}),
    point({s: 'p', pid: 1, tid: 1}),
    point({s: 'p', pid: 1, tid: 2}),
    point({s: 'g', pid: 1}),
    point({s: 'g', pid: 'other'}),
    point({pid: '', tid: ''}),
    point(),
  ])
  expect(tracks).toHaveLength(7)
  expect(tracks.find(track => track.scope === 'process')!.events).toHaveLength(2)
  expect(tracks.find(track => track.scope === 'global')!.events).toHaveLength(2)
  expect(new Set(tracks.map(track => track.id)).size).toBe(7)
})

test('plain, gzip, tiny UTF-8 chunks and worker imports preserve point metadata and transfer ownership', async () => {
  const text = fixture(),
    bytes = new TextEncoder().encode(text)
  const expected = (await importProfileGroupFromText('instants.json', text))!
  let offset = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) controller.close()
      else {
        controller.enqueue(bytes.subarray(offset, Math.min(offset + 3, bytes.length)))
        offset = Math.min(offset + 3, bytes.length)
      }
    },
  })
  const tiny = (await importDurationTraceStream(stream, 'instants.json'))!
  expect(exportProfileGroup(tiny)).toEqual(exportProfileGroup(expected))
  const zipped = zlib.gzipSync(text)
  const compressed = zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer
  const gzip = (await tryImportDurationTrace(compressed, 'instants.json.gz'))!
  expect(numeric(gzip.instantTracks!)).toEqual(numeric(expected.instantTracks!))
  const response = await processTraceInWorker(
    {name: 'instants.json.gz', input: compressed},
    () => {},
  )
  if (response.type !== 'result') throw new Error('Expected worker result')
  expect(numeric(response.group.instantTracks!)).toEqual(numeric(expected.instantTracks!))
  for (const track of response.group.instantTracks!)
    expect(snapshotTransferables(response.group)).toContain(track.times.buffer)
})

test('legacy I-phase CPU profiles retain priority while ordinary names remain point events', async () => {
  const data = {startTime: 100, endTime: 110, nodes: [], samples: [], timeDeltas: []}
  const cpu = {
    ph: 'I',
    name: 'CpuProfile',
    pid: 1,
    tid: 2,
    ts: 100,
    args: {data: {cpuProfile: data}},
  }
  expect(isChromeCPUProfileRecord(cpu)).toBe(true)
  const traces = [
    point({name: 'Profile'}),
    cpu,
    point({name: 'CpuProfile', ts: 105, pid: 1, tid: 2}),
  ]
  expect(
    await tryImportDurationTrace(
      new TextEncoder().encode(JSON.stringify(traces)).buffer as ArrayBuffer,
      'mixed.json',
    ),
  ).toBeNull()
  const imported = (await importProfileGroupFromText('mixed.json', JSON.stringify(traces)))!
  expect(imported.profiles).toHaveLength(1)
  expect(imported.instantTracks).toHaveLength(2)
  expect(imported.instantTracks![0].clock).toBe('chrome-timeline:wall')
  expect(imported.instantTracks![1].events[0].name).toBe('CpuProfile')
  const named = importFromChromeTimeline([point()] as any, 'Trace-20261121T010101.json')
  expect(named.profiles).toEqual([])
  expect(named.instantTracks).toHaveLength(1)
})

test('historical JIT records remain outside ordinary instant interpretation', () => {
  expect(
    importTraceInstantTracks([point({name: 'JitCodeAdded'}), point({name: 'JitCodeMoved'})]),
  ).toEqual([])
})

test('scope, timestamp, label, details and range errors are explicit and never silently truncated', () => {
  for (const s of ['invalid', null, 1])
    expect(() => importTraceInstantTracks([point({s})])).toThrow('scope')
  for (const ts of ['1', null, NaN, Infinity])
    expect(() => importTraceInstantTracks([point({ts})])).toThrow('timestamp')
  expect(() => importTraceInstantTracks([point({name: 'x'.repeat(513)})])).toThrow('label')
  expect(() => importTraceInstantTracks([point({args: {text: 'x'.repeat(16385)}})])).toThrow(
    '16,384',
  )
  expect(() =>
    importTraceInstantTracks([point({ts: -Number.MAX_VALUE}), point({ts: Number.MAX_VALUE})]),
  ).toThrow('range overflows')
  expect(() => importTraceInstantTracks([point({pid: {}})])).toThrow('pid')
})

test('details validation bounds recursion and nodes before invoking serializers or getters', () => {
  const circular: any = {}
  circular.self = circular
  expect(() => importTraceInstantTracks([point({args: circular})])).toThrow('cycle')
  let deep: any = {}
  for (let i = 0; i < 10; i++) deep = {nested: deep}
  expect(() => importTraceInstantTracks([point({args: deep})])).toThrow('depth')
  expect(() => importTraceInstantTracks([point({args: new Array(4097).fill(0)})])).toThrow('nodes')
  const getter = jest.fn(() => 'secret'),
    serializer = jest.fn(() => 'x'.repeat(100000))
  const args = {}
  Object.defineProperty(args, 'value', {enumerable: true, get: getter})
  expect(() => importTraceInstantTracks([point({args})])).toThrow('getters')
  expect(getter).not.toHaveBeenCalled()
  expect(() => importTraceInstantTracks([point({args: {toJSON: serializer}})])).toThrow(
    'serializer',
  )
  expect(serializer).not.toHaveBeenCalled()
})

test('details retain escaped strings, lone surrogates and structured JSON exactly', () => {
  const args = {text: 'SQL\n"quoted"\\\t😀\ud800', array: [null, true, -0, 1.5], object: {x: 2}}
  const track = importTraceInstantTracks([
    point({args, id: 'id', id2: {global: 1}, sf: 0, stack: []}),
  ])[0]
  expect(JSON.parse(track.events[0].details!)).toEqual(
    JSON.parse(JSON.stringify({id: 'id', id2: {global: 1}, args, stack: [], sf: 0})),
  )
})

test('lane, raw-point and aggregate metadata budgets apply before numeric allocation', () => {
  expect(() =>
    importTraceInstantTracks(Array.from({length: 257}, (_, tid) => point({tid}))),
  ).toThrow('256')
  expect(() => importTraceInstantTracks(new Array(250001).fill(point()))).toThrow('250,000')
  expect(() =>
    importTraceInstantTracks(new Array(8200).fill(point({name: 'x'.repeat(512)}))),
  ).toThrow('metadata')
})

test('stream and worker instant validation failures propagate instead of falling back or truncating', async () => {
  for (const event of [point({s: 'invalid'}), point({args: {text: 'x'.repeat(16385)}})]) {
    const bytes = new TextEncoder().encode(JSON.stringify([event])).buffer as ArrayBuffer
    await expect(tryImportDurationTrace(bytes, 'invalid.json')).rejects.toThrow('Trace instant:')
    await expect(
      processTraceInWorker({name: 'invalid.json', input: bytes}, () => {}),
    ).rejects.toThrow('Trace instant:')
  }
  const bytes = new TextEncoder().encode(JSON.stringify([point()])).buffer as ArrayBuffer
  await expect(
    tryImportDurationTrace(bytes, 'limited.json', {limits: {maxRetainedBytes: 5}}),
  ).rejects.toThrow('retained event bytes')
})

test('mixed captures omit all over-budget markers explicitly while pure markers remain strict', async () => {
  const stack = {ph: 'X', name: 'work', ts: 0, dur: 20, pid: 1, tid: 1}
  const cases = [
    {events: new Array(250001).fill(point()), reason: 'point-limit'},
    {events: Array.from({length: 257}, (_, tid) => point({tid})), reason: 'track-limit'},
    {events: new Array(8200).fill(point({name: 'x'.repeat(512)})), reason: 'metadata-limit'},
    {events: [point({args: {text: 'x'.repeat(16385)}})], reason: 'details-limit'},
  ]
  for (const {events, reason} of cases) {
    const text = JSON.stringify([stack, ...events])
    const group = (await importProfileGroupFromText('mixed.json', text))!
    expect(group.profiles[0].getTotalWeight()).toBe(20)
    expect(group.instantTracks).toBeUndefined()
    expect(group.instantEventOmission).toEqual({count: events.length, reason})
    const native = exportProfileGroup(group)
    expect(exportProfileGroup(importSpeedscopeProfiles(native))).toEqual(native)
    expect(() => importTraceInstantTracks(events)).toThrow()
  }
  // Below resource caps malformed data still fails instead of becoming a notice.
  await expect(
    importProfileGroupFromText('mixed.json', JSON.stringify([stack, point({s: 'bad'})])),
  ).rejects.toThrow('scope')
})

test('mixed omission summary survives plain, gzip streaming and worker boundaries', async () => {
  const events = [
    {ph: 'C', name: 'gauge', ts: 1, args: {value: 2}},
    point({args: {text: 'x'.repeat(16385)}}),
    point(),
  ]
  const text = JSON.stringify(events)
  const expected = {count: 2, reason: 'details-limit'}
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer
  const plain = (await tryImportDurationTrace(bytes, 'mixed.json'))!
  expect(plain.instantEventOmission).toEqual(expected)
  expect(plain.counterTracks).toHaveLength(1)
  const compressed = zlib.gzipSync(text)
  const gzip = (await tryImportDurationTrace(
    compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    ) as ArrayBuffer,
    'mixed.json.gz',
  ))!
  expect(gzip.instantEventOmission).toEqual(expected)
  const worker = await processTraceInWorker({name: 'mixed.json', input: bytes}, () => {})
  if (worker.type !== 'result') throw new Error('Expected worker result')
  expect(worker.group.instantEventOmission).toEqual(expected)
  expect(worker.group.instantTracks).toBeUndefined()
})

test('Chrome CPU captures preserve profiles and publish resource omissions without absorbing ordinary malformed markers', () => {
  const cpu = {
    ph: 'I',
    name: 'CpuProfile',
    pid: 1,
    tid: 2,
    ts: 100,
    args: {
      data: {cpuProfile: {startTime: 100, endTime: 110, nodes: [], samples: [], timeDeltas: []}},
    },
  }
  const group = importFromChromeTimeline(
    [cpu, point({args: {text: 'x'.repeat(16385)}})] as any,
    'chrome.json',
  )
  expect(group.profiles).toHaveLength(1)
  expect(group.instantTracks).toBeUndefined()
  expect(group.instantEventOmission).toEqual({count: 1, reason: 'details-limit'})
  expect(() => importFromChromeTimeline([cpu, point({s: 'bad'})] as any, 'chrome.json')).toThrow(
    'scope',
  )
  const getter = jest.fn(() => ({cpuProfile: {}}))
  const args = {}
  Object.defineProperty(args, 'data', {enumerable: true, get: getter})
  expect(() => importTraceInstantTracks([point({name: 'CpuProfile', args})])).toThrow('getters')
  expect(getter).not.toHaveBeenCalled()
})

test('selected top-level details fields reject accessors without invocation or inherited reads', () => {
  for (const name of ['point', 'CpuProfile']) {
    const getter = jest.fn(() => ({data: {cpuProfile: {}}}))
    const event = point({name})
    Object.defineProperty(event, 'args', {enumerable: true, get: getter})
    expect(isChromeCPUProfileRecord(event)).toBe(false)
    expect(() => importTraceInstantTracks([event])).toThrow('getters or setters')
    expect(getter).not.toHaveBeenCalled()
  }
  for (const key of ['pid', 'tid', 'id', 'id2', 'stack', 'sf', 'tts']) {
    const getter = jest.fn(() => 1)
    const event = point()
    Object.defineProperty(event, key, {enumerable: true, get: getter})
    expect(() => importTraceInstantTracks([event])).toThrow('getters or setters')
    expect(getter).not.toHaveBeenCalled()
  }
  const setter = jest.fn()
  const event = point()
  Object.defineProperty(event, 'args', {enumerable: true, set: setter})
  expect(() => importTraceInstantTracks([event])).toThrow('getters or setters')
  expect(setter).not.toHaveBeenCalled()
  const inherited = jest.fn(() => ({unexpected: true}))
  const prototype = {}
  Object.defineProperty(prototype, 'args', {get: inherited})
  Object.defineProperty(prototype, 'pid', {get: inherited})
  const track = importTraceInstantTracks([Object.assign(Object.create(prototype), point())])[0]
  expect(track.events[0].details).toBeUndefined()
  expect(track.processId).toBeUndefined()
  expect(inherited).not.toHaveBeenCalled()
})

test('oversized valid labels and IDs are resource omissions only for mixed captures', async () => {
  const stack = {ph: 'X', name: 'work', ts: 0, dur: 20, pid: 1, tid: 1}
  for (const field of ['name', 'cat', 'pid', 'tid']) {
    const event = point({[field]: 'x'.repeat(513)})
    try {
      importTraceInstantTracks([event])
      throw new Error('Expected resource failure')
    } catch (error) {
      expect(error).toBeInstanceOf(InstantEventResourceLimitError)
      expect((error as InstantEventResourceLimitError).reason).toBe('metadata-limit')
    }
    const group = (await importProfileGroupFromText('mixed.json', JSON.stringify([stack, event])))!
    expect(group.profiles[0].getTotalWeight()).toBe(20)
    expect(group.instantTracks).toBeUndefined()
    expect(group.instantEventOmission).toEqual({count: 1, reason: 'metadata-limit'})
  }
  for (const name of ['', ' ', '\n', 1, null]) {
    const event = point({name})
    try {
      importTraceInstantTracks([event])
      throw new Error('Expected malformed label failure')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(InstantEventResourceLimitError)
    }
    await expect(
      importProfileGroupFromText('mixed.json', JSON.stringify([stack, event])),
    ).rejects.toThrow('label')
  }
})
