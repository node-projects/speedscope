import * as fs from 'fs'
import {importFromAndroidMethodTrace, isAndroidMethodTrace} from './android-method-trace'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {importProfilesFromArrayBuffer} from '.'

type Record = [number, number, number, number?]
function capture(options: {
  version?: number
  clock?: string
  records?: Record[]
  methods?: string
  recordSize?: number
  keyVersion?: number
}) {
  const version = options.version ?? 3,
    clock = options.clock ?? 'wall'
  const dual = clock === 'dual'
  const records = options.records || [
    [1, 4, 0],
    [1, 5, 20],
  ]
  const recordSize = options.recordSize ?? (version === 1 ? 9 : dual ? 14 : 10)
  const key = `*version\n${
    options.keyVersion ?? version
  }\nclock=${clock}\n*threads\n1\tmain\n*methods\n${
    options.methods ||
    '0x4\tapp/Main\trun\t()V\tMain.java\t12\n0x8\tapp/Main\twork\t()V\tMain.java\t24'
  }\n*end\n`
  const header = Buffer.alloc(32)
  header.write('SLOW')
  header.writeUInt16LE(version, 4)
  header.writeUInt16LE(32, 6)
  header.writeUInt16LE(recordSize, 16)
  const data = Buffer.alloc(records.length * recordSize)
  for (let i = 0; i < records.length; i++) {
    const offset = i * recordSize,
      [thread, method, time, wall = time] = records[i]
    const width = version === 1 ? 1 : 2
    if (width === 1) data.writeUInt8(thread, offset)
    else data.writeUInt16LE(thread, offset)
    data.writeUInt32LE(method, offset + width)
    data.writeUInt32LE(time, offset + width + 4)
    if (dual) data.writeUInt32LE(wall, offset + width + 8)
  }
  return Buffer.concat([Buffer.from(key), header, data])
}
function input(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}
const read = (buffer: Buffer) => importFromAndroidMethodTrace('capture.trace', input(buffer))!
const fixture = fs.readFileSync('./sample/profiles/android-method-trace/synthetic-dual.trace')

test('classic dual-clock Android traces preserve thread identities, clock units and independent timing', () => {
  const group = read(fixture)
  expect(group.profiles.map(profile => profile.getName())).toEqual([
    'main (#1) — thread CPU time',
    'main (#1) — wall time',
    'worker (#513) — thread CPU time',
    'worker (#513) — wall time',
  ])
  expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual([20, 50, 7, 25])
  for (const profile of group.profiles) expect(profile.getWeightUnit()).toBe('microseconds')
  expect(group.profiles[0].getFrame(4)!.getTotalWeight()).toBe(20)
  expect(group.profiles[0].getFrame(8)!.getSelfWeight()).toBe(5)
  expect(group.profiles[1].getFrame(4)!.getTotalWeight()).toBe(40)
  expect(group.profiles[1].getFrame(8)!.getTotalWeight()).toBe(15)
  expect(group.profiles[0].getFrame(8)!.file).toBe('com/example/Main.java')
  expect(group.profiles[0].getFrame(8)!.line).toBe(24)
  expect(group.profiles[0].getFrame(8)!.name).toBe('com.example.Main.work(I)V')
  expect(group.profiles[2].getFrame(12)!.name).toBe('com.example.Main.work()V')
  const exported = exportProfileGroup(group)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
})

test('v1 uses one-byte thread IDs/global wall clock; v2 uses two-byte IDs/thread CPU clock', () => {
  const first = read(
    capture({
      version: 1,
      clock: 'global',
      records: [
        [255, 4, 3],
        [255, 5, 14],
      ],
    }),
  ).profiles[0]
  expect(first.getName()).toBe('Thread (#255) — wall time')
  expect(first.getFrame(4)!.getTotalWeight()).toBe(11)
  const second = read(
    capture({
      version: 2,
      clock: 'thread-cpu',
      records: [
        [65535, 4, 0],
        [65535, 5, 9],
      ],
    }),
  ).profiles[0]
  expect(second.getName()).toBe('Thread (#65535) — thread CPU time')
  expect(second.getTotalWeight()).toBe(9)
})

test('capture-boundary exits reconstruct outer scopes and unfinished calls close only at observed end', () => {
  const profile = read(
    capture({
      records: [
        [1, 8, 2],
        [1, 9, 5],
        [1, 5, 10],
        [1, 8, 14],
      ],
    }),
  ).profiles[0]
  expect(profile.getFrame(4)!.getTotalWeight()).toBe(10)
  expect(profile.getFrame(8)!.getTotalWeight()).toBe(3)
  const root = profile.getAppendOrderCalltreeRoot()
  expect(root.children[0].frame.key).toBe(4)
  expect(root.children[0].children[0].frame.key).toBe(8)
  expect(profile.getTotalWeight()).toBe(14)
})

test('unwind actions exit each method and reconstruct a pre-capture ancestor', () => {
  const profile = read(
    capture({
      records: [
        [1, 8, 2],
        [1, 10, 9],
        [1, 6, 9],
      ],
    }),
  ).profiles[0]
  expect(profile.getFrame(4)!.getTotalWeight()).toBe(9)
  expect(profile.getFrame(8)!.getTotalWeight()).toBe(7)
  const known = read(
    capture({
      records: [
        [1, 4, 1],
        [1, 8, 3],
        [1, 10, 7],
        [1, 6, 7],
      ],
    }),
  ).profiles[0]
  expect(known.getFrame(4)!.getTotalWeight()).toBe(6)
  expect(known.getFrame(8)!.getTotalWeight()).toBe(4)
  expect(() =>
    read(
      capture({
        records: [
          [1, 4, 1],
          [1, 8, 3],
          [1, 6, 7],
        ],
      }),
    ),
  ).toThrow('does not match its stack')
})

test('unsigned high method IDs and v3 padded records retain method identity', () => {
  const profile = read(
    capture({
      methods: '0x80000004\tapp/Main\trun\t()V',
      records: [
        [1, 0x80000004, 0],
        [1, 0x80000005, 9],
      ],
      recordSize: 18,
    }),
  ).profiles[0]
  expect(profile.getFrame(0x80000004)!.getTotalWeight()).toBe(9)
})

test('invalid record actions, methods, stack transitions and decreasing clocks fail explicitly', () => {
  for (const [records, error] of [
    [[[1, 7, 0]], 'reserved method action'],
    [[[1, 12, 0]], 'unknown method ID'],
    [
      [
        [1, 4, 0],
        [1, 9, 2],
      ],
      'does not match its stack',
    ],
    [
      [
        [1, 4, 10],
        [1, 5, 9],
      ],
      'wall timestamps decrease',
    ],
  ] as [Record[], string][])
    expect(() => read(capture({records}))).toThrow(error)
  expect(() =>
    read(
      capture({
        clock: 'thread-cpu',
        records: [
          [1, 4, 10],
          [1, 5, 9],
        ],
      }),
    ),
  ).toThrow('CPU timestamps decrease')
  expect(() =>
    read(
      capture({
        clock: 'dual',
        records: [
          [1, 4, 1, 20],
          [1, 5, 2, 19],
        ],
      }),
    ),
  ).toThrow('wall timestamps decrease')
})

test('truncated records/headers and incompatible version/clock metadata are rejected', () => {
  expect(() => read(fixture.subarray(0, fixture.length - 1))).toThrow('truncated final record')
  expect(() => read(Buffer.from('*version\n3\nclock=wall\n'))).toThrow('missing *end')
  expect(() => read(capture({version: 4}))).toThrow('unsupported version 4')
  expect(() => read(capture({keyVersion: 2}))).toThrow('version mismatch')
  expect(() => read(capture({version: 2, clock: 'dual'}))).toThrow('dual clock requires')
  expect(() => read(capture({clock: 'mystery'}))).toThrow('unsupported clock')
  const tooSmall = Buffer.from(fixture),
    binary = tooSmall.indexOf('SLOW')
  tooSmall.writeUInt16LE(10, binary + 16)
  expect(() => read(tooSmall)).toThrow('too small')
  const offset = Buffer.from(fixture)
  offset.writeUInt16LE(17, binary + 6)
  expect(() => read(offset)).toThrow('invalid data offset')
})

test('binary-only/streaming variants are detected but rejected without guessing a clock', () => {
  expect(isAndroidMethodTrace(input(Buffer.from('SLOW\u0000\u0000')))).toBe(true)
  expect(() => read(Buffer.from('SLOW\u0000\u0000'))).toThrow('streaming/binary-only')
  expect(isAndroidMethodTrace(input(Buffer.from('{"traceEvents":[]}')))).toBe(false)
  expect(importFromAndroidMethodTrace('other', input(Buffer.from('hello')))).toBe(null)
  const noClock = Buffer.from(capture({}).toString('binary').replace('clock=wall\n', ''), 'binary')
  expect(() => read(noClock)).toThrow('missing explicit clock')
})

test('metadata preserves class-only and source-only methods and rejects duplicates/malformed IDs', () => {
  const profile = read(capture({methods: '0x4\tapp/Main\tMain.java\t0'})).profiles[0]
  expect(profile.getFrame(4)!.name).toBe('app.Main')
  expect(profile.getFrame(4)!.file).toBe('app/Main.java')
  expect(profile.getFrame(4)!.line).toBeUndefined()
  expect(read(capture({methods: '0x4\tapp/Main'})).profiles[0].getFrame(4)!.name).toBe('app.Main')
  expect(() => read(capture({methods: '0x5\tapp/Main'}))).toThrow('action bits clear')
  expect(() => read(capture({methods: '0x4\tapp/Main\n0x4\tapp/Main'}))).toThrow('duplicate method')
  expect(() => read(capture({methods: '0x4\tapp/Main\trun'}))).toThrow('invalid method metadata')
})

test('declared record counts detect whole-record truncation, while Unicode/CRLF keys preserve offsets', () => {
  const binary = fs.readFileSync('./sample/profiles/android-method-trace/synthetic-dual.trace')
  expect(() => readBytes(binary.subarray(0, binary.length - 14))).toThrow('record count mismatch')
  const offset = binary.indexOf('SLOW')
  const key = binary
    .subarray(0, offset)
    .toString('utf8')
    .replace('main', 'méthod λ')
    .replace(/\n/g, '\r\n')
  const combined = Buffer.concat([Buffer.from('\uFEFF' + key), binary.subarray(offset)])
  expect(readBytes(combined).profiles[0].getName()).toBe('méthod λ (#1) — thread CPU time')
})

function readBytes(bytes: Buffer) {
  return importFromAndroidMethodTrace(
    'capture.trace',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )!
}

test('fixed records are consumed directly for long traces without a parsed event list', () => {
  const count = 10000,
    prefix = capture({records: []})
  const events = Buffer.alloc(count * 20)
  for (let i = 0; i < count; i++) {
    for (const [position, action, time] of [
      [i * 20, 4, i * 2],
      [i * 20 + 10, 5, i * 2 + 1],
    ]) {
      events.writeUInt16LE(1, position)
      events.writeUInt32LE(action, position + 2)
      events.writeUInt32LE(time, position + 6)
    }
  }
  const profile = readBytes(Buffer.concat([prefix, events])).profiles[0]
  expect(profile.getFrame(4)!.getTotalWeight()).toBe(count)
  expect(profile.getTotalWeight()).toBe(count * 2 - 1)
})

test('ordinary importer detects an Android trace by signature, not filename', async () => {
  const bytes = fs.readFileSync('./sample/profiles/android-method-trace/synthetic-dual.trace')
  const group = await importProfilesFromArrayBuffer(
    'renamed.bin',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  expect(group!.profiles).toHaveLength(4)
  expect(group!.profiles.map(profile => profile.getTotalWeight())).toEqual([20, 50, 7, 25])
  expect(group!.profiles.every(profile => profile.getWeightUnit() === 'microseconds')).toBe(true)
})
