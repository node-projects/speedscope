/** @jest-environment node */
import {importTraceEvents} from './trace-event'
import {importDurationTraceStream} from './streaming-trace'
import {importProfilesFromArrayBuffer} from './index'
import {processTraceInWorker} from './trace-worker'
import {exportProfileGroup} from '../lib/file-format'
import {importFromChromeTimeline, importFromChromeCPUProfile, CPUProfile} from './chrome'

function events(epoch = 0) {
  return [
    {ph: 'X', pid: 2, tid: 7, ts: epoch + 310, dur: 5, name: 'later'},
    {ph: 'E', pid: 1, tid: 9, ts: epoch + 110, name: 'first'},
    {ph: 'M', pid: 1, tid: 9, ts: epoch - 1000, name: 'thread_name', args: {name: 'wall thread'}},
    {ph: 'X', pid: 2, tid: 7, ts: epoch + 300, dur: 5, name: 'second'},
    {ph: 'B', pid: 1, tid: 9, ts: epoch + 100, tts: 1, name: 'first'},
  ]
}
function payload(group: ReturnType<typeof importTraceEvents>) {
  const result = exportProfileGroup(group)
  for (const profile of result.profiles) delete profile.timeline
  return result
}

test('thread origins retain earliest raw wall timestamps before local normalization and profile sorting', () => {
  const group = importTraceEvents(events())
  expect(group.profiles.map(profile => profile.getTimelineOrigin())).toEqual([
    {clock: 'trace-event:wall', start: 100},
    {clock: 'trace-event:wall', start: 300},
  ])
  expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual([10, 15])
  const begins: number[] = []
  group.profiles[0].forEachCall(
    (_node, value) => begins.push(value),
    () => {},
  )
  expect(begins).toEqual([0])
})

test('positive and negative epochs shift only origins, preserving normalized weights and source identities', () => {
  const baseline = importTraceEvents(events())
  for (const epoch of [1e15, -1e15]) {
    const shifted = importTraceEvents(events(epoch))
    expect(shifted.profiles.map(profile => profile.getTimelineOrigin()!.start)).toEqual([
      epoch + 100,
      epoch + 300,
    ])
    expect(payload(shifted)).toEqual(payload(baseline))
  }
})

test('an unmatched earliest end event also defines the normalization origin', () => {
  const group = importTraceEvents([
    {ph: 'B', ts: 10, name: 'later'},
    {ph: 'E', ts: 12, name: 'later'},
    {ph: 'E', ts: 5, name: 'pre-capture'},
  ])
  expect(group.profiles[0].getTimelineOrigin()).toEqual({clock: 'trace-event:wall', start: 5})
})

test('generic, tiny-chunk streaming and worker duration imports preserve identical origins', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(events(1e15)))
  const generic = await importProfilesFromArrayBuffer('origins.json', encoded.slice().buffer)
  let offset = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (offset === encoded.length) controller.close()
      else {
        controller.enqueue(encoded.subarray(offset, Math.min(encoded.length, offset + 7)))
        offset = Math.min(encoded.length, offset + 7)
      }
    },
  })
  const streamed = await importDurationTraceStream(stream, 'origins.json')
  expect(exportProfileGroup(streamed!)).toEqual(exportProfileGroup(generic!))
  const worker = await processTraceInWorker(
    {name: 'origins.json', input: encoded.slice().buffer},
    () => {},
  )
  if (worker.type !== 'result') throw new Error('Expected worker result')
  expect(worker.group.profiles.map(profile => profile.timeline)).toEqual(
    generic!.profiles.map(profile => profile.getTimelineOrigin()),
  )
})

function cpu(startTime: number): CPUProfile {
  return {
    startTime,
    endTime: startTime + 10,
    nodes: [
      {
        id: 1,
        hitCount: 1,
        callFrame: {
          functionName: 'run',
          scriptId: '1',
          url: 'app.js',
          lineNumber: 0,
          columnNumber: 0,
        },
      },
    ],
    samples: [1],
    timeDeltas: [5],
  }
}
test('only shared Chrome Timeline provenance anchors CPU profiles; standalone CPU imports remain unanchored', () => {
  const traces = [200, 100].map((start, index) => ({
    ph: 'P',
    pid: 1,
    tid: index,
    ts: start,
    name: 'CpuProfile',
    args: {data: {cpuProfile: cpu(start)}},
  })) as any
  const group = importFromChromeTimeline(traces, 'capture')
  expect(group.profiles.map(profile => profile.getTimelineOrigin())).toEqual([
    {clock: 'chrome-timeline:wall', start: 100},
    {clock: 'chrome-timeline:wall', start: 200},
  ])
  expect(importFromChromeCPUProfile(cpu(100)).getTimelineOrigin()).toBeUndefined()
})

test('Chrome chunk profiles without explicit source startTime do not gain synthesized zero origins', () => {
  const {startTime: _start, ...withoutStart} = cpu(0)
  const group = importFromChromeTimeline(
    [
      {ph: 'P', pid: 1, tid: 1, ts: 500, id: 'id', name: 'Profile', args: {data: {}}},
      {
        ph: 'P',
        pid: 1,
        tid: 1,
        ts: 501,
        id: 'id',
        name: 'ProfileChunk',
        args: {
          data: {
            ...withoutStart,
            cpuProfile: {nodes: withoutStart.nodes, samples: withoutStart.samples},
          },
        },
      },
    ] as any,
    'capture',
  )
  expect(group.profiles[0].getTimelineOrigin()).toBeUndefined()
})
