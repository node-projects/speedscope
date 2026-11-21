import * as fs from 'fs'
import {importFromJavaThreadDump, isJavaThreadDump} from './java-thread-dump'
import {
  StringBackedTextFileContent,
  TextFileContent,
  withMockedFileChunkSizeForTests,
} from './utils'
import {importProfileGroupFromText, importProfilesFromArrayBuffer} from '.'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {Profile} from '../lib/profile'

const fixture = fs.readFileSync('./sample/profiles/java-thread-dump/synthetic.jstack', 'utf8')
const read = (text: string) =>
  importFromJavaThreadDump(new StringBackedTextFileContent(text), 'capture.jstack')
function calls(profile: Profile) {
  const names: string[] = []
  profile.forEachCall(
    node => names.push(node.frame.name),
    () => {},
  )
  return names
}

test('Java dumps count observed stacks without inventing timing or missing-thread samples', () => {
  const group = read(fixture)!
  expect(group.profiles.map(p => p.getName())).toEqual(['main (#1)', 'worker (#2)', 'worker (#3)'])
  expect(group.profiles.map(p => p.getTotalWeight())).toEqual([2, 2, 1])
  for (const profile of group.profiles) {
    expect(profile.getWeightUnit()).toBe('none')
    expect(profile.isChronological()).toBe(false)
  }
  expect(calls(group.profiles[0])).toEqual(['app.Main.main', 'app.Main.render', 'app.Main.render'])
  const mainFrames = [...group.profiles[0].getFrames()]
  expect(mainFrames.filter(f => f.name === 'app.Main.render').map(f => [f.file, f.line])).toEqual([
    ['Main.java', 20],
    ['Main.java', 21],
  ])
  expect(calls(group.profiles[1])).not.toContain('app.Worker.thisIsADiagnosticRepeat')
  expect(
    [...group.profiles[1].getFrames()].find(f => f.name.endsWith('.park'))!.file,
  ).toBeUndefined()
  const unknown = [...group.profiles[2].getFrames()][0]
  expect(unknown.name).toBe('java.base@21.0.1/java.lang.Thread.run')
  expect(unknown.file).toBeUndefined()
  expect(unknown.line).toBeUndefined()
})

test('pre-Java-ID headers group by normalized tid and keep duplicate names separate', () => {
  const text = `Full thread dump Java HotSpot(TM) Client VM:
"worker" prio=5 tid=0x000abc nid=0x1 runnable
    at app.Worker.first(Worker.java:1)

"worker" prio=5 tid=0xdef nid=0x2 runnable
    at app.Worker.second(Worker.java:2)

Full thread dump Java HotSpot(TM) Client VM:
"worker" prio=5 tid=0xABC nid=0x1 runnable
    at app.Worker.first(Worker.java:1)
`
  const group = read(text)!
  expect(group.profiles.map(p => p.getName())).toEqual(['worker (tid 0xabc)', 'worker (tid 0xdef)'])
  expect(group.profiles.map(p => p.getTotalWeight())).toEqual([2, 1])
})

test('unrelated text, stacktraces without a dump header, and no-Java-stack dumps are rejected', () => {
  for (const text of [
    '',
    'hello',
    'Exception in thread "main"\n at app.Main.main(Main.java:1)',
    'Full thread dump OpenJDK VM:\n"VM Thread" tid=0x1 nid=1 runnable\n',
  ]) {
    expect(read(text)).toBe(null)
  }
  expect(isJavaThreadDump(fixture)).toBe(true)
  expect(isJavaThreadDump('not a Full thread dump Java VM')).toBe(false)
})

test('malformed Java frames and duplicate identities do not silently produce partial profiles', () => {
  const header = 'Full thread dump OpenJDK VM:\n"worker" #2 prio=5 tid=0x2 nid=2 runnable\n'
  expect(() => read(header + '    at missing-location\n')).toThrow('Invalid Java stack frame')
  expect(() =>
    read(header + '    at app.Worker.run(Worker.java:1)\n"broken" tid=oops nid=2\n'),
  ).toThrow('Invalid thread header')
  expect(() =>
    read(
      header + '    at app.Worker.run(Worker.java:1)\n"worker" #2 prio=5 tid=0x2 nid=2 runnable\n',
    ),
  ).toThrow('Duplicate thread')
})

test('parser consumes one line iterator and does not split or parse the entire input', () => {
  let iterations = 0
  const contents: TextFileContent = {
    firstChunk: () => {
      throw new Error('No eager detector in parser')
    },
    parseAsJSON: () => {
      throw new Error('Not JSON')
    },
    splitLines: () => ({
      *[Symbol.iterator]() {
        if (++iterations > 1) throw new Error('Multiple full scans')
        yield 'Full thread dump OpenJDK VM:'
        for (let i = 0; i < 2000; i++) {
          yield `"worker-${i}" #${i} prio=5 tid=0x${i.toString(16)} nid=${i} runnable`
          yield '    at app.Worker.run(Worker.java:1)'
          yield ''
        }
      },
    }),
  }
  expect(importFromJavaThreadDump(contents, 'many.jstack')!.profiles.length).toBe(2000)
  expect(iterations).toBe(1)
})

test('ordinary detection, tiny byte chunks, BOM/CRLF and export round-trip preserve observations', async () => {
  const text = '\uFEFF' + fixture.replace(/\n/g, '\r\n')
  const group = await importProfileGroupFromText('renamed.txt', text)
  expect(group!.profiles.map(p => p.getTotalWeight())).toEqual([2, 2, 1])
  const input = new TextEncoder().encode(text).buffer as ArrayBuffer
  await withMockedFileChunkSizeForTests(7, async () => {
    const chunked = await importProfilesFromArrayBuffer('capture.jstack', input)
    expect(exportProfileGroup(chunked!)).toEqual(
      exportProfileGroup({...group!, name: 'capture.jstack'}),
    )
  })
  const serialized = exportProfileGroup(group!)
  expect(exportProfileGroup(importSpeedscopeProfiles(serialized))).toEqual(serialized)
})

test('recognizable text dumps avoid a whole-document JSON parse attempt', async () => {
  const parse = jest.spyOn(StringBackedTextFileContent.prototype, 'parseAsJSON')
  try {
    const group = await importProfileGroupFromText('capture.txt', fixture)
    expect(group!.profiles.length).toBe(3)
    expect(parse).not.toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
})

test('blank separation before a stack is tolerated, while orphan frames cannot silently disappear', () => {
  const header = 'Full thread dump OpenJDK VM:\n"worker" #2 prio=5 tid=0x2 nid=2 runnable\n'
  const group = read(
    header + '\n   java.lang.Thread.State: RUNNABLE\n\n    at app.Worker.run(Worker.java:1)\n',
  )
  expect(group!.profiles[0].getTotalWeight()).toBe(1)
  expect(() =>
    read(
      header + '    at app.Worker.run(Worker.java:1)\n\n    at app.Worker.orphan(Worker.java:2)\n',
    ),
  ).toThrow('no thread header')
})
