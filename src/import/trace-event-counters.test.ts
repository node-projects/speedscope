/** @jest-environment node */
import fs from 'fs'
import zlib from 'zlib'
import {importTraceCounterTracks, TRACE_COUNTER_LIMITS} from './trace-event-counters'
import {importTraceEvents} from './trace-event'
import {importProfileGroupFromText} from './index'
import {tryImportDurationTrace, importDurationTraceStream} from './streaming-trace'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {processTraceInWorker} from './trace-worker'
import {snapshotTransferables} from '../lib/profile-snapshot'
import {importFromChromeTimeline} from './chrome'

const fixture = () => fs.readFileSync('sample/profiles/trace-event/counters.json', 'utf8')
const counter = (args: any = {value: 1}, ts: any = 100, extra: any = {}) => ({
  ph: 'C',
  name: 'metric',
  ts,
  args,
  ...extra,
})
function numeric(tracks: ReturnType<typeof importTraceCounterTracks>) {
  return tracks.map(track => ({
    ...track,
    times: Array.from(track.times),
    values: Array.from(track.values),
  }))
}

test('imports independent numeric series, sorting timestamps and keeping last duplicate observations', () => {
  const group = importTraceEvents(JSON.parse(fixture()))
  expect(group.profiles).toHaveLength(1)
  expect(group.profiles[0].getTotalWeight()).toBe(20)
  expect(Array.from(group.profiles[0].getFrames())).toHaveLength(1)
  const tracks = numeric(group.counterTracks!)
  expect(tracks).toHaveLength(2)
  expect(tracks[0]).toMatchObject({
    name: 'Heap / used',
    start: 100,
    clock: 'trace-event:wall',
    timeUnit: 'microseconds',
    valueUnit: 'unknown',
    times: [0, 10, 20],
    values: [4, 7, 9],
    processId: '1',
    threadId: '2',
  })
  expect(tracks[1].values).toEqual([16, 12, 11])
  group.name = 'synthetic counters'
  const exported = exportProfileGroup(group)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
})

test('counter-only input creates no artificial stack profile or duration', async () => {
  const text = JSON.stringify([counter({signed: -5, fraction: 0.25}, -100)])
  const group = await importProfileGroupFromText('counters.json', text)
  expect(group!.profiles).toEqual([])
  expect(numeric(group!.counterTracks!)).toHaveLength(2)
  expect(group!.counterTracks![0].start).toBe(-100)
  expect(Array.from(group!.counterTracks![0].times)).toEqual([0])
  expect(Array.from(group!.counterTracks![0].values)).toEqual([-5])
})

test('counter names cannot masquerade as sampled Chrome CPU profile markers', async () => {
  const text = JSON.stringify(
    ['Profile', 'ProfileChunk', 'CpuProfile'].map(name =>
      counter({value: 1}, 100, {name, pid: 1, tid: 2, cat: 'counter'}),
    ),
  )
  const generic = await importProfileGroupFromText('counters.json', text)
  const streamed = await tryImportDurationTrace(
    new TextEncoder().encode(text).buffer as ArrayBuffer,
    'counters.json',
  )
  expect(generic!.profiles).toEqual([])
  expect(generic!.counterTracks).toHaveLength(3)
  expect(numeric(streamed!.counterTracks!)).toEqual(numeric(generic!.counterTracks!))
})

test('identity distinguishes argument keys, categories, processes, threads, id values and their types', () => {
  const events = [
    counter({a: 1, b: 2}),
    counter({a: 1}, 100, {cat: 'other'}),
    counter({a: 1}, 100, {pid: 1}),
    counter({a: 1}, 100, {pid: '1'}),
    counter({a: 1}, 100, {tid: 1}),
    counter({a: 1}, 100, {tid: '1'}),
    counter({a: 1}, 100, {id: 1}),
    counter({a: 1}, 100, {id: '1'}),
  ]
  const tracks = importTraceCounterTracks(events)
  expect(tracks).toHaveLength(9)
  expect(new Set(tracks.map(track => track.id)).size).toBe(9)
})

test('generic, native-gzip and tiny-chunk streaming imports preserve counter arrays exactly', async () => {
  const text = fixture()
  const bytes = new TextEncoder().encode(text)
  const expected = exportProfileGroup((await importProfileGroupFromText('counters.json', text))!)
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
  const streamed = await importDurationTraceStream(stream, 'counters.json')
  expect(exportProfileGroup(streamed!)).toEqual(expected)
  const zipped = zlib.gzipSync(text)
  const gzip = await tryImportDurationTrace(
    zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer,
    'counters.json.gz',
  )
  expect(numeric(gzip!.counterTracks!)).toEqual(numeric(streamed!.counterTracks!))
})

test('worker counter-only result includes transferable typed buffers', async () => {
  const input = new TextEncoder().encode(JSON.stringify([counter(), counter({value: 4}, 120)]))
    .buffer as ArrayBuffer
  const response = await processTraceInWorker({name: 'counter-only.json', input}, () => {})
  if (response.type !== 'result') throw new Error('Expected result')
  expect(response.group.profiles).toEqual([])
  const track = response.group.counterTracks![0]
  expect(snapshotTransferables(response.group)).toContain(track.times.buffer)
  expect(snapshotTransferables(response.group)).toContain(track.values.buffer)
  expect(Array.from(track.values)).toEqual([1, 4])
})

test('streaming keeps typed counter identities and enforces retained-record byte limits', async () => {
  const text = JSON.stringify([
    counter({value: 2}, 100, {id: 1, cat: 'one'}),
    counter({value: 3}, 100, {id: '1', cat: 'two'}),
  ])
  const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer
  const group = await tryImportDurationTrace(buffer, 'counters.json')
  expect(group!.counterTracks).toHaveLength(2)
  expect(group!.counterTracks![0].name).toContain('[1]')
  expect(group!.counterTracks![1].name).toContain('["1"]')
  expect(group!.counterTracks![1].category).toBe('two')
  await expect(
    tryImportDurationTrace(buffer, 'counters.json', {limits: {maxRetainedBytes: 5}}),
  ).rejects.toThrow('retained event bytes')
})

test('Chrome CPU Timeline counters share that capture clock and retain original event order', () => {
  const data = {startTime: 100, endTime: 110, nodes: [], samples: [], timeDeltas: []}
  const group = importFromChromeTimeline(
    [
      counter({value: 2}, 100),
      {ph: 'P', name: 'CpuProfile', pid: 1, tid: 2, ts: 100, args: {data: {cpuProfile: data}}},
      counter({value: 3}, 100),
    ] as any,
    'chrome',
  )
  expect(group.counterTracks![0].clock).toBe('chrome-timeline:wall')
  expect(group.profiles[0].getTimelineOrigin()!.clock).toBe(group.counterTracks![0].clock)
  expect(Array.from(group.counterTracks![0].values)).toEqual([3])
})

test('non-numeric or malformed counters fail explicitly rather than silently changing stack data', () => {
  for (const args of [
    {value: '4'},
    {value: true},
    {value: null},
    {value: {}},
    {value: NaN},
    {value: Infinity},
    [],
    null,
    {},
  ]) {
    expect(() => importTraceCounterTracks([counter(args)])).toThrow(/Trace counter/)
  }
  for (const timestamp of [undefined, null, '4', NaN, Infinity])
    expect(() => importTraceCounterTracks([{...counter(), ts: timestamp}])).toThrow(/timestamp/)
  expect(() => importTraceCounterTracks([counter({value: 1}, 100, {id2: {local: 1}})])).toThrow(
    'id2',
  )
  expect(() => importTraceCounterTracks([counter({value: 1}, 100, {pid: {}})])).toThrow('pid')
  expect(() =>
    importTraceCounterTracks([
      counter({value: 1}, -Number.MAX_VALUE),
      counter({value: 2}, Number.MAX_VALUE),
    ]),
  ).toThrow('timestamp range overflows')
})

test('series, raw observation and metadata limits fail before creating oversized output', () => {
  expect(() =>
    importTraceCounterTracks(Array.from({length: 257}, (_, id) => counter({value: 1}, 100, {id}))),
  ).toThrow('256')
  const old = {...TRACE_COUNTER_LIMITS}
  try {
    Object.assign(TRACE_COUNTER_LIMITS, {pointsPerTrack: 2})
    expect(() => importTraceCounterTracks([counter(), counter(), counter()])).toThrow('1,000,000')
    TRACE_COUNTER_LIMITS.pointsPerTrack = old.pointsPerTrack
    Object.assign(TRACE_COUNTER_LIMITS, {points: 2})
    expect(() => importTraceCounterTracks([counter({a: 1, b: 2, c: 3})])).toThrow('2,000,000')
    TRACE_COUNTER_LIMITS.points = old.points
    Object.assign(TRACE_COUNTER_LIMITS, {metadataCharacters: 2})
    expect(() => importTraceCounterTracks([counter()])).toThrow('metadata')
  } finally {
    Object.assign(TRACE_COUNTER_LIMITS, old)
  }
})
