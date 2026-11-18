import {importProfileGroupFromText} from './index'
import {importTraceEvents} from './trace-event'
import {importFromLinuxPerf} from './linux-tools-perf'
import {importFromBGFlameGraph} from './bg-flamegraph'
import {importFromCallgrind} from './callgrind'
import {StringBackedTextFileContent} from './utils'

test('evented profiles infer omitted bounds instead of producing NaN (#287)', async () => {
  const group = await importProfileGroupFromText(
    'profile.json',
    JSON.stringify({
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      shared: {frames: [{name: 'work'}]},
      profiles: [
        {
          type: 'evented',
          name: 'test',
          unit: 'milliseconds',
          events: [
            {type: 'O', frame: 0, at: 10},
            {type: 'C', frame: 0, at: 15},
          ],
        },
      ],
    }),
  )
  expect(group!.profiles[0].getTotalWeight()).toBe(5)
})

test('named, empty and large-string trace IDs remain distinct (#470, #480)', () => {
  const ids = ['Spans', 'Traces', '', '9007199254740992', '9007199254740993']
  const trace = ids.map((pid, i) => ({
    ph: 'X',
    pid,
    tid: 'Worker',
    name: `work${i}`,
    ts: 0,
    dur: 2,
  }))
  const group = importTraceEvents(trace)
  expect(group.profiles).toHaveLength(ids.length)
  expect(new Set(group.profiles.map(p => p.getName())).size).toBe(ids.length)
  for (const profile of group.profiles) expect(profile.getTotalWeight()).toBe(2)
})

test('unnamed end events close the current stack (#345)', () => {
  const group = importTraceEvents([
    {ph: 'B', name: 'outer', pid: 1, tid: 1, ts: 0},
    {ph: 'B', name: 'inner', pid: 1, tid: 1, ts: 1},
    {ph: 'E', pid: 1, tid: 1, ts: 2},
    {ph: 'E', pid: 1, tid: 1, ts: 3},
  ])
  const outer = group.profiles[0].getGroupedCalltreeRoot().children[0]
  expect(outer.getTotalWeight()).toBe(3)
  expect(outer.children[0].getTotalWeight()).toBe(1)
})

test('nearby epoch-timestamp events remain siblings (#487)', () => {
  const events = [
    {name: 'A', ph: 'X', ts: 1732107141551429.079, dur: 34670882.955, pid: 1, tid: 1},
    {name: 'B', ph: 'X', ts: 1732107142997066.682, dur: 476375.838, pid: 1, tid: 1},
    {name: 'C', ph: 'X', ts: 1732107143473442.569, dur: 300492.826, pid: 1, tid: 1},
  ]
  const group = importTraceEvents(events)
  const outer = group.profiles[0].getGroupedCalltreeRoot().children[0]
  expect(outer.children.map(c => c.frame.name).sort()).toEqual(['B', 'C'])
})

test('hybrid CPU event names do not discard migrated samples (#554)', () => {
  const text = ['cpu_atom/cycles/u', 'cpu_core/cycles/u', 'cpu_core/cycles/u']
    .map((type, i) => `x 1 [000] ${1 + i}.000000: 10 ${type}:\n  123 work (/app)\n`)
    .join('\n')
  const group = importFromLinuxPerf(new StringBackedTextFileContent(text))!
  expect(group.profiles).toHaveLength(1)
  expect(group.profiles[0].getTotalWeight()).toBe(2)
})

test('perf counter profiles use event weights and keep separate event kinds (#335)', () => {
  const text =
    'x 1 1.000000: 7 page-faults:\n  123 fault (/app)\n\nx 1 2.000000: 9 instructions:\n  124 cpu (/app)\n'
  const group = importFromLinuxPerf(new StringBackedTextFileContent(text))!
  expect(group.profiles.map(p => p.getTotalWeight())).toEqual([7, 9])
  expect(group.profiles.map(p => p.getWeightUnit())).toEqual(['none', 'none'])
  expect(group.profiles[0].getName()).toContain('page-faults')
  expect(group.profiles[1].getName()).toContain('instructions')
})

test('perf without call stacks explains the recording requirement (#193)', () => {
  expect(() =>
    importFromLinuxPerf(new StringBackedTextFileContent('x 1 1.000000: cycles:\n')),
  ).toThrow('Record with -g')
})

test('folded weights support fractions, exponents and trailing whitespace (#157)', () => {
  const profile = importFromBGFlameGraph(
    new StringBackedTextFileContent('main;work 1.5  \nmain;other .25\nmain;work 2e1\n'),
  )!
  expect(profile.getTotalWeight()).toBe(21.75)
  expect(() => importFromBGFlameGraph(new StringBackedTextFileContent('main -1\n'))).toThrow(
    'non-negative',
  )
})

test('malformed JSON reports its syntax failure (#359)', async () => {
  await expect(importProfileGroupFromText('bad.json', '{"traceEvents":')).rejects.toThrow()
})

test('jump compression mappings do not consume subsequent costs (#550)', () => {
  const text =
    'events: Ir\nfl=main.c\nfn=main\n1 2\njfi=(2) other.c\njfn=(2) other\njump=1 2\n2 3\nfl=(2)\nfn=(2)\n1 4\n'
  const group = importFromCallgrind(new StringBackedTextFileContent(text), 'jumps')!
  expect(group.profiles[0].getTotalWeight()).toBe(9)
})
