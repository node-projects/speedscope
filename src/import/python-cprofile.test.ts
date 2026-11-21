import fs from 'fs'
import {
  checkPythonCProfileFileSize,
  CPROFILE_LIMITS,
  importFromPythonCProfile,
  isPythonCProfile,
} from './python-cprofile'
import {importProfilesFromArrayBuffer} from './index'
import {exportProfileGroup} from '../lib/file-format'

function bytes(input: Buffer): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}
const directory = 'sample/profiles/python-cprofile/'
function fixture(name: string) {
  return bytes(fs.readFileSync(directory + name))
}
type Encodable = number | string | Encodable[] | Map<Encodable, Encodable>
function encode(value: Encodable): Buffer {
  if (typeof value === 'string') {
    const text = Buffer.from(value)
    const header = Buffer.alloc(5)
    header[0] = 117
    header.writeInt32LE(text.length, 1)
    return Buffer.concat([header, text])
  }
  if (typeof value === 'number') {
    const output = Buffer.alloc(9)
    output[0] = 103
    output.writeDoubleLE(value, 1)
    return output
  }
  if (Array.isArray(value))
    return Buffer.concat([Buffer.from([41, value.length]), ...value.map(encode)])
  const chunks: Buffer[] = [Buffer.from('{')]
  for (const [key, item] of value) chunks.push(encode(key), encode(item))
  chunks.push(Buffer.from('0'))
  return Buffer.concat(chunks)
}
const label = (name: string): Encodable => ['fixture.py', 1, name]
function record(self: number, callers = new Map<Encodable, Encodable>()): Encodable {
  return [1, 1, self, self, callers]
}
function data(entries: [Encodable, Encodable][]) {
  return bytes(encode(new Map(entries)))
}

test('real CPython cProfile fixture imports exact flat self and direct caller attribution', async () => {
  const expected = JSON.parse(fs.readFileSync(directory + 'expected.json', 'utf8')) as {
    name: string
    file: string
    line: number
    self: number
    callers: {name: string; self: number}[]
  }[]
  for (const name of ['native.prof', ...Array.from({length: 6}, (_, i) => `marshal-v${i}.prof`)]) {
    const group = await importFromPythonCProfile(fixture(name), name)
    expect(group.profiles).toHaveLength(2)
    const [flat, callers] = group.profiles
    const total = expected.reduce((sum, item) => sum + item.self, 0)
    expect(flat.getTotalWeight()).toBeCloseTo(total, 14)
    expect(callers.getTotalWeight()).toBeCloseTo(total, 14)
    expect(flat.getWeightUnit()).toBe('seconds')
    expect(group.profiles.every(item => !item.isChronological())).toBe(true)
    const root = flat.getGroupedCalltreeRoot()
    for (const item of expected) {
      const node = root.children.find(child => child.frame.name === item.name)!
      expect(node.getSelfWeight()).toBeCloseTo(item.self, 14)
      expect(node.children).toHaveLength(0)
      if (item.file !== '~') expect(node.frame.file).toBe(item.file)
    }
    const leaf = expected.find(item => item.name === 'leaf')!
    expect(leaf.callers).toHaveLength(3)
    for (const edge of leaf.callers) {
      const parent = callers
        .getGroupedCalltreeRoot()
        .children.find(item => item.frame.name === edge.name)!
      const child = parent.children.find(item => item.frame.name === 'leaf')!
      expect(child.getSelfWeight()).toBeCloseTo(edge.self, 14)
      expect(child.children).toHaveLength(0)
    }
    const recursive = callers
      .getGroupedCalltreeRoot()
      .children.find(item => item.frame.name === 'recursive')!
    expect(recursive.children.some(item => item.frame.name === 'recursive')).toBe(true)
  }
})

test('generic binary import accepts explicit extensions only and roundtrips aggregate exports', async () => {
  const buffer = fixture('native.prof')
  expect(isPythonCProfile(buffer, 'test.pstats')).toBe(true)
  expect(isPythonCProfile(buffer, 'test.cprofile')).toBe(true)
  expect(isPythonCProfile(buffer, 'test.bin')).toBe(false)
  const group = (await importProfilesFromArrayBuffer('native.prof', buffer))!
  const exported = exportProfileGroup(group)
  expect(exported.profiles).toHaveLength(2)
  expect(exported.profiles.every(item => item.isChronological === false)).toBe(true)
  const json = bytes(Buffer.from(JSON.stringify(exported)))
  expect(isPythonCProfile(json, 'renamed.prof')).toBe(false)
  const restored = (await importProfilesFromArrayBuffer('renamed.prof', json))!
  expect(restored.profiles.map(item => item.getTotalWeight())).toEqual(
    group.profiles.map(item => item.getTotalWeight()),
  )
})

test('multiple callers and recursive edges are immediate-only; residual retains unattributed self', async () => {
  const input = data([
    [
      label('child'),
      record(
        10,
        new Map([
          [label('a'), [1, 1, 2, 2]],
          [label('child'), [1, 1, 3, 3]],
        ]),
      ),
    ],
  ])
  const group = await importFromPythonCProfile(input, 'test.prof')
  expect(group.profiles.map(item => item.getTotalWeight())).toEqual([10, 10])
  const root = group.profiles[1].getGroupedCalltreeRoot()
  expect(root.children.find(item => item.frame.name === 'child')!.getSelfWeight()).toBe(5)
  expect(root.children.find(item => item.frame.name === 'child')!.children[0].getSelfWeight()).toBe(
    3,
  )
})

test('inconsistent caller totals preserve exact flat profile with explicit attribution-unavailable label', async () => {
  const group = await importFromPythonCProfile(
    data([[label('child'), record(1, new Map([[label('a'), [1, 1, 2, 2]]]))]]),
    'test.prof',
  )
  expect(group.profiles).toHaveLength(1)
  expect(group.profiles[0].getTotalWeight()).toBe(1)
  expect(group.profiles[0].getName()).toContain('caller attribution unavailable')
})

test('rejects executable/unsupported types, truncation, trailing data, cycles and bad references', async () => {
  for (const input of [
    Buffer.from('c'),
    Buffer.from('{r\x00\x00\x00\x00'),
    Buffer.from([251, 114, 0, 0, 0, 0]),
    Buffer.from('{0x'),
    Buffer.from('{)\x03u\xff\xff\xff\x7f'),
  ])
    await expect(importFromPythonCProfile(bytes(input), 'bad.prof')).rejects.toThrow(
      'Python cProfile',
    )
  const valid = Buffer.from(fixture('native.prof'))
  await expect(
    importFromPythonCProfile(bytes(valid.subarray(0, valid.length - 1)), 'bad.prof'),
  ).rejects.toThrow('truncated')
})

test('rejects duplicate identities, invalid counts/times and empty data', async () => {
  const duplicate = data([
    [label('same'), record(1)],
    [label('same'), record(2)],
  ])
  await expect(importFromPythonCProfile(duplicate, 'bad.prof')).rejects.toThrow(
    'duplicate function',
  )
  for (const value of [NaN, Infinity, -1])
    await expect(
      importFromPythonCProfile(data([[label('bad'), record(value)]]), 'bad.prof'),
    ).rejects.toThrow('finite')
  await expect(
    importFromPythonCProfile(data([[label('bad'), [2, 1, 1, 1, new Map()]]]), 'bad.prof'),
  ).rejects.toThrow('primitive calls')
  await expect(importFromPythonCProfile(data([]), 'bad.prof')).rejects.toThrow('empty profile')
})

test('caps declared string/input allocations and preflights oversized Files without reading body', async () => {
  const huge = Buffer.alloc(5)
  huge[0] = 117
  huge.writeInt32LE(CPROFILE_LIMITS.singleStringBytes + 1, 1)
  await expect(importFromPythonCProfile(bytes(huge), 'bad.prof')).rejects.toThrow('string limit')
  await expect(
    importFromPythonCProfile(new ArrayBuffer(CPROFILE_LIMITS.bytes + 1), 'bad.prof'),
  ).rejects.toThrow('32 MiB')
  const slice = jest.fn(() => ({arrayBuffer: async () => fixture('native.prof').slice(0, 6)}))
  const arrayBuffer = jest.fn()
  const file = {
    name: 'huge.prof',
    size: CPROFILE_LIMITS.bytes + 1,
    slice,
    arrayBuffer,
  } as unknown as File
  await expect(checkPythonCProfileFileSize(file)).rejects.toThrow('32 MiB')
  expect(slice).toHaveBeenCalledWith(0, 6)
  expect(arrayBuffer).not.toHaveBeenCalled()
})

test('reads exact long integer counts and Unicode locations without coercing unsafe integers', async () => {
  const count = 2 ** 33
  const raw = encode(
    new Map([
      [
        ['路径/файл.py', 7, 'méthode'],
        [count, count, 1, 1, new Map()],
      ],
    ]),
  )
  const number = encode(count)
  // Marshal LONG little-endian limbs [0,0,8] encode 2^33 exactly.
  const long = Buffer.from([108, 3, 0, 0, 0, 0, 0, 0, 0, 8, 0])
  const first = raw.indexOf(number),
    second = raw.indexOf(number, first + number.length)
  const input = Buffer.concat([
    raw.subarray(0, first),
    long,
    raw.subarray(first + number.length, second),
    long,
    raw.subarray(second + number.length),
  ])
  const group = await importFromPythonCProfile(bytes(input), 'unicode.prof')
  const actual = group.profiles[0].getGroupedCalltreeRoot().children[0].frame
  expect(actual).toMatchObject({file: '路径/файл.py', line: 7, name: 'méthode'})
  const unsafe = data([
    [label('bad'), [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1, 1, 1, new Map()]],
  ])
  await expect(importFromPythonCProfile(unsafe, 'bad.prof')).rejects.toThrow('exact integers')
})

test('rejects deep nested containers before JavaScript stack exhaustion', async () => {
  const nested = Buffer.concat([
    Buffer.from('{'),
    Buffer.concat(Array.from({length: 30}, () => Buffer.from([41, 1]))),
    Buffer.from('i\x00\x00\x00\x00'),
  ])
  await expect(importFromPythonCProfile(bytes(nested), 'bad.prof')).rejects.toThrow('depth limit')
})

test('cancels before and during incremental decoding', async () => {
  const input = data(
    Array.from({length: 10000}, (_, i) => [label(String(i)), record(1)] as [Encodable, Encodable]),
  )
  const before = new AbortController()
  before.abort()
  await expect(
    importFromPythonCProfile(input, 'test.prof', {signal: before.signal}),
  ).rejects.toHaveProperty('name', 'AbortError')
  const during = new AbortController()
  const pending = importFromPythonCProfile(input, 'test.prof', {signal: during.signal})
  setTimeout(() => during.abort(), 0)
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
})
