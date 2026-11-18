import {importFromCallgrind} from './callgrind'
import {importFromBGFlameGraph} from './bg-flamegraph'
import {importFromChromeCPUProfile} from './chrome'
import {importTraceEvents} from './trace-event'
import {StringBackedTextFileContent} from './utils'
import {checkProfileSnapshot} from '../lib/test-utils'

test('Callgrind instruction and line position columns', async () => {
  await checkProfileSnapshot('./sample/profiles/callgrind/callgrind.instr-line-positions.log')
  await checkProfileSnapshot('./sample/profiles/callgrind/callgrind.positions-instr.log')
  await checkProfileSnapshot('./sample/profiles/callgrind/callgrind.instr-line-subposition.log')
})

test('Callgrind inline files do not split callers or orphan callees', () => {
  const input = `events: Instructions
fl=main.c
fn=main
1 1
fi=inline.h
cfn=work
calls=1 1
1 5
fn=other
1 2
fl=inline.h
fn=work
1 5
`
  const group = importFromCallgrind(new StringBackedTextFileContent(input), 'inline')!
  const profile = group.profiles[0]
  const frames: string[] = []
  profile.forEachFrame(frame => frames.push(`${frame.name}:${frame.file}`))
  expect(frames.sort()).toEqual(['main:main.c', 'other:main.c', 'work:inline.h'])
  const root = profile.getGroupedCalltreeRoot()
  expect(root.children.map(n => n.frame.name)).toEqual(['main', 'other'])
  expect(root.children[0].children[0].frame.name).toBe('work')
  expect(profile.getTotalWeight()).toBe(8)
})

test('folded-stack comments are ignored without dropping real frames', () => {
  const profile = importFromBGFlameGraph(
    new StringBackedTextFileContent(
      '# duration: 1000\n  # metadata 200\nmain;work 3\nmain;hash#name 2\n',
    ),
  )!
  const frames: string[] = []
  profile.forEachFrame(frame => frames.push(frame.name))
  expect(frames.sort()).toEqual(['hash#name', 'main', 'work'])
  expect(profile.getTotalWeight()).toBe(5)
})

test('Chrome program samples are independent but GC retains its stack', () => {
  const profile = importFromChromeCPUProfile({
    startTime: 0,
    endTime: 50,
    nodes: ['(root)', 'work', '(program)', '(garbage collector)'].map((name, i) => ({
      id: i + 1,
      hitCount: 1,
      children: i === 0 ? [2, 3, 4] : [],
      callFrame: {functionName: name, scriptId: '0', url: '', lineNumber: -1, columnNumber: -1},
    })),
    samples: [2, 3, 2, 4, 2],
    timeDeltas: [0, 10, 10, 10, 10],
  })
  const parents = new Map<string, string>()
  profile.forEachCall(
    node => {
      parents.set(node.frame.name, node.parent!.frame.name)
    },
    () => {},
  )
  expect(parents.get('(program)')).toBe('(speedscope root)')
  expect(parents.get('(garbage collector)')).toBe('work')
})

test('missing trace IDs and explicit zero IDs share metadata and a profile', () => {
  const group = importTraceEvents([
    {ph: 'M', name: 'process_name', ts: 0, args: {name: 'proc'}},
    {ph: 'M', name: 'thread_name', ts: 0, args: {name: 'thread'}},
    {ph: 'B', name: 'work', ts: 0},
    {ph: 'E', name: 'work', ts: 5, pid: '0', tid: '0'},
  ])
  expect(group.profiles).toHaveLength(1)
  expect(group.profiles[0].getName()).toBe('proc (pid 0), thread (tid 0)')
  expect(group.profiles[0].getTotalWeight()).toBe(5)
})
