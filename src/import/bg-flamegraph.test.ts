import {checkProfileSnapshot} from '../lib/test-utils'
import * as fs from 'fs'
import {importFromBGFlameGraph} from './bg-flamegraph'
import {StringBackedTextFileContent, withMockedFileChunkSizeForTests} from './utils'
import {importProfilesFromArrayBuffer} from '.'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'

test('importFromBGFlameGraph', async () => {
  await checkProfileSnapshot('./sample/profiles/stackcollapse/simple.txt')
})

test('importFromBGFlameGraph with CRLF', async () => {
  await checkProfileSnapshot('./sample/profiles/stackcollapse/simple-crlf.txt')
})

test('importFromBGFlameGraph with UTF-16, Little Endian', async () => {
  await checkProfileSnapshot('./sample/profiles/stackcollapse/simple-utf16-le.txt')
})

test('importFromBGFlameGraph with UTF-16, Big Endian', async () => {
  await checkProfileSnapshot('./sample/profiles/stackcollapse/simple-utf16-be.txt')
})

test('importFromBGFlameGraph with invalid lines', async () => {
  await checkProfileSnapshot('./sample/profiles/stackcollapse/simple-with-invalids.txt')
})

const pythonSampling = fs.readFileSync(
  './sample/profiles/python-sampling/synthetic.collapsed',
  'utf8',
)

test('Python 3.15 sampling collapsed output retains counts, thread roots and literal labels (#528)', () => {
  const profile = importFromBGFlameGraph(new StringBackedTextFileContent(pythonSampling))!
  expect(profile.getTotalWeight()).toBe(17)
  expect(profile.getWeightUnit()).toBe('none')
  expect(profile.isChronological()).toBe(false)
  expect(
    profile.getGroupedCalltreeRoot().children.map(node => [node.frame.name, node.getTotalWeight()]),
  ).toEqual([
    ['tid:101', 10],
    ['tid:202', 7],
  ])
  for (const [name, weight] of [
    ['worker.py:parse_payload:40', 7],
    ['<native>', 5],
    ['<GC>', 3],
    ['λ_worker.py:<lambda>:23', 2],
  ] as [string, number][]) {
    const frame = profile.getFrame(name)!
    expect(frame.name).toBe(name)
    expect(frame.getSelfWeight()).toBe(weight)
    // Generic folded labels have no producer discriminator. Do not invent
    // source paths or line metadata by interpreting arbitrary colon names.
    expect(frame.file).toBeUndefined()
    expect(frame.line).toBeUndefined()
  }
  const moduleNode = profile.getGroupedCalltreeRoot().children[0].children[0]
  expect(moduleNode.frame.name).toBe('main.py:<module>:1')
  expect(moduleNode.children[0].frame.name).toBe('main.py:run:12')
})

test('Python sampling collapsed text is autodetected across tiny UTF-8 chunks and round-trips', async () => {
  const bytes = new TextEncoder().encode(pythonSampling.replace(/\n/g, '\r\n'))
  await withMockedFileChunkSizeForTests(3, async () => {
    const group = await importProfilesFromArrayBuffer('capture.txt', bytes.buffer as ArrayBuffer)
    expect(group!.profiles).toHaveLength(1)
    expect(group!.profiles[0].getTotalWeight()).toBe(17)
    const exported = exportProfileGroup(group!)
    expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
    expect(exported.shared.frames.some(frame => frame.name === 'λ_worker.py:<lambda>:23')).toBe(
      true,
    )
  })
})
