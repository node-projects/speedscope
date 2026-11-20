import * as fs from 'fs'
import {importProfilesFromArrayBuffer} from '../import'
import {checkProfileSnapshot} from '../lib/test-utils'
import {withMockedFileChunkSizeForTests} from './utils'
import {importTraceEvents} from './trace-event'
import {exportProfileGroup} from '../lib/file-format'

test('complete-event queues preserve unordered timing and argument-based frame identity', () => {
  const complete = []
  const explicit = []
  for (let i = 0; i < 2000; i++) {
    const common = {name: 'work', pid: 1, tid: 2, args: {category: i % 7, text: 'unicode 雪'}}
    complete.push({...common, ph: 'X', ts: i * 3 + 100, dur: 2})
    explicit.push({...common, ph: 'B', ts: i * 3 + 100})
    explicit.push({...common, ph: 'E', ts: i * 3 + 102})
  }
  complete.reverse()
  explicit.reverse()
  expect(exportProfileGroup(importTraceEvents(complete))).toEqual(
    exportProfileGroup(importTraceEvents(explicit)),
  )
  expect(complete.every(event => event.ph === 'X')).toBe(true)
})

test('importTraceEvents large event queues', () => {
  const count = 250000
  const events = []
  for (let i = 0; i < count; i++) {
    events.push({ph: 'B', name: 'work', pid: 1, tid: 0, ts: i * 2})
    events.push({ph: 'E', name: 'work', pid: 1, tid: 0, ts: i * 2 + 1})
  }

  const group = importTraceEvents(events)
  expect(group.profiles).toHaveLength(1)
  const profile = group.profiles[0]
  expect(profile.getTotalWeight()).toBe(count * 2 - 1)
  let calls = 0
  let closes = 0
  let valid = true
  profile.forEachCall(
    (node, value) => {
      valid = valid && node.frame.name === 'work' && value === calls * 2
      calls++
    },
    (_node, value) => {
      valid = valid && value === closes * 2 + 1
      closes++
    },
  )
  expect(calls).toBe(count)
  expect(closes).toBe(count)
  expect(valid).toBe(true)
})

test('importTraceEvents simple', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple.json')
})

test('importTraceEvents simple object', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-object.json')
})

test('importTraceEvents multiprocess', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/multiprocess.json')
})

test('importTraceEvents partial json import', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial.json')
})

test('importTraceEvents partial json import chunked', async () => {
  await withMockedFileChunkSizeForTests(100, async () => {
    await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial.json')
  })
})

test('importTraceEvents partial json import trailing comma', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial-trailing-comma.json')
})

test('importTraceEvents partial json import trailing comma chunked', async () => {
  await withMockedFileChunkSizeForTests(100, async () => {
    await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial-trailing-comma.json')
  })
})

test('importTraceEvents partial json import whitespace padding', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial-whitespace.json')
})

test('importTraceEvents partial json import whitespace padding chunked', async () => {
  await withMockedFileChunkSizeForTests(100, async () => {
    await checkProfileSnapshot('./sample/profiles/trace-event/simple-partial-whitespace.json')
  })
})

test('importTraceEvents bad E events', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/too-many-end-events.json')
})

test('importTraceEvents different number of start and end calls to same function at same timestamp', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simultaneous-anonymous-calls.json')
})

test('importTraceEvents event re-ordering', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/must-retain-original-order.json')
})

test('importTraceEvents end-non-top-of-stack', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/end-non-top-of-stack.json')
})

test('importTraceEvents mismatched args', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/mismatched-args.json')
})

test('importTraceEvents mismatched name', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/mismatched-name.json')
})

test('importTraceEvents not enough end events', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/not-enough-end-events.json')
})

test('importTraceEvents not out-of-order unbalanced name', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/out-of-order-unbalanced-name.json')
})

test('importTraceEvents not out-of-order', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/out-of-order.json')
})

test('importTraceEvents unbalanced name', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/unbalanced-name.json')
})

test('importTraceEvents unbalanced args', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/unbalanced-args.json')
})

test('importTraceEvents end event with empty stack', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/end-event-with-empty-stack.json')
})

test('importTraceEvents only begin events', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/only-begin-events.json')
})

test('importTraceEvents zero duration events', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/zero-duration-events.json')
})

test('importTraceEvents matching x', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/matching-x.json')
})

test('importTraceEvents x events matching start', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/x-events-matching-start.json')
})

test('importTraceEvents x events matching end', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/x-events-matching-end.json')
})

test('importTraceEvents BEX interaction', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/bex-interaction.json')
})

test('importTraceEvents invalid x nesting', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/invalid-x-nesting.json')
})

test('importTraceEvents event reordering name match', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/event-reordering-name-match.json')
})

test('importTraceEvents simple hermes profile', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-hermes.json')
})

test('importTraceEvents hermes profile with multiple frames', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-hermes.json')
})

test('importTraceEvents simple profile with samples', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/simple-with-samples.json')
})

test('importTraceEvents multi-thread profile with samples', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/multi-thread-with-samples.json')
})

test('importTraceEvents missing pid', async () => {
  await checkProfileSnapshot('./sample/profiles/trace-event/missing-pid.json')
})

test('importTraceEvents samples with missing pid', async () => {
  const buffer = fs.readFileSync('./sample/profiles/trace-event/samples-missing-pid.json')
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const profileGroup = await importProfilesFromArrayBuffer('samples-missing-pid.json', arrayBuffer)

  if (!profileGroup) {
    fail('Failed to extract profile')
    return
  }

  // Samples without a pid and samples with "pid": 0 belong to the same profile.
  expect(profileGroup.profiles.length).toEqual(1)

  // The missing pid on the process_name/thread_name metadata events is treated
  // as 0 too, so the profile name is built from them.
  expect(profileGroup.profiles[0].getName()).toEqual('myproc (pid 0), mythread (tid 7)')

  // 4 samples spaced 1000us apart: the deltas sum to 3000us.
  expect(profileGroup.profiles[0].getTotalWeight()).toEqual(3000)
})
