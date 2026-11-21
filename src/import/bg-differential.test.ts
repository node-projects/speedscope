/** @jest-environment node */
import * as zlib from 'zlib'
import {
  createDifferentialFoldedParser,
  importFromBGDifferential,
  isDifferentialFoldedName,
} from './bg-differential'
import {StringBackedTextFileContent} from './utils'
import {tryImportTextProfile, importTextProfileStream} from './streaming-text-profile'
import {importProfilesFromArrayBuffer} from './index'
import {compareProfiles} from '../lib/profile-comparison'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {processTraceInWorker} from './trace-worker'

const text =
  '# baseline candidate\r\nmain;retained 8 3\r\nmain;removed 2 0\r\nmain;added 0 9\r\nλ;日本語 0.5 1.25\r\nzero 0 0\r\n'
const buffer = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer
test('two nonnegative columns preserve removed and added paths and signed differences (#228)', async () => {
  const group = importFromBGDifferential(
    new StringBackedTextFileContent(text),
    'capture.diff.folded',
  )!
  expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual([10.5, 13.25])
  expect(group.profiles.every(profile => !profile.isChronological())).toBe(true)
  const model = await compareProfiles(group.profiles[0], group.profiles[1], {mode: 'absolute'})
  const deltas = new Map(
    model.nodes.filter(node => node.frame).map(node => [node.frame!.name, node.selfDelta]),
  )
  expect(deltas.get('retained')).toBe(-5)
  expect(deltas.get('removed')).toBe(-2)
  expect(deltas.get('added')).toBe(9)
  expect(deltas.get('日本語')).toBe(0.75)
  const exported = exportProfileGroup(group)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
})

test('streaming plain/gzip differential files avoid whole-file reads and match generic UTF-16 decoding', async () => {
  const name = 'capture.diff.folded'
  const expected = importFromBGDifferential(new StringBackedTextFileContent(text), name)!
  const utf16 = new Uint8Array(Buffer.from('\ufeff' + text, 'utf16le')).buffer as ArrayBuffer
  expect(exportProfileGroup((await importProfilesFromArrayBuffer(name, utf16))!)).toEqual(
    exportProfileGroup(expected),
  )
  for (const gzip of [false, true]) {
    const fileName = name + (gzip ? '.gz' : '')
    const file = new File(
      [gzip ? new Uint8Array(zlib.gzipSync(Buffer.from(text))) : text],
      fileName,
    )
    const read = jest.spyOn(file, 'arrayBuffer')
    const group = (await tryImportTextProfile(file, fileName))!
    expect(read).not.toHaveBeenCalled()
    expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual([10.5, 13.25])
    const worker = await processTraceInWorker({name: fileName, input: file}, () => {})
    expect(worker.type).toBe('result')
    if (worker.type === 'result') expect(worker.group.profiles).toHaveLength(2)
  }
})

test('one-byte chunk boundaries keep Unicode and differential columns intact', async () => {
  const bytes = new Uint8Array(buffer(text))
  let at = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(at, ++at))
    },
  })
  const actual = (await importTextProfileStream(stream, 'tiny.diff.folded', 'differential'))!
  const expected = importFromBGDifferential(
    new StringBackedTextFileContent(text),
    'tiny.diff.folded',
  )!
  expect(exportProfileGroup(actual)).toEqual(exportProfileGroup(expected))
})

test('explicit differential selection preserves ordinary folded labels ending in numbers', async () => {
  expect(isDifferentialFoldedName('x.diff.folded.gz')).toBe(true)
  expect(isDifferentialFoldedName('x.differential.stacks')).toBe(true)
  expect(isDifferentialFoldedName('x.folded')).toBe(false)
  const ordinary = (await tryImportTextProfile(buffer('function 12 3\n'), 'x.folded'))!
  expect(ordinary.profiles).toHaveLength(1)
  expect(ordinary.profiles[0].getFrame('function 12')!.getSelfWeight()).toBe(3)
})

test('malformed, negative, nonfinite and overflowing differential weights fail explicitly', () => {
  for (const line of [
    'x 1',
    'x -1 2',
    'x 1 -2',
    'x NaN 2',
    'x 1 Infinity',
    'x 1e999 1',
    'x 0x20 1',
  ]) {
    expect(() => createDifferentialFoldedParser('bad').pushLine(line)).toThrow(
      /Differential folded/,
    )
  }
  const parser = createDifferentialFoldedParser('overflow')
  parser.pushLine('x 1e308 0')
  expect(() => parser.pushLine('x 1e308 0')).toThrow(/overflow/)
  expect(() => createDifferentialFoldedParser('deep', 2).pushLine('a;b;c 1 1')).toThrow(/depth/)
})

test('stream resource limits and cancellation apply to differential inputs', async () => {
  const stream = () => new Blob([text]).stream()
  await expect(
    importTextProfileStream(stream(), 'x.diff.folded', 'differential', {limits: {maxSamples: 2}}),
  ).rejects.toThrow(/sample count/)
  await expect(
    importTextProfileStream(stream(), 'x.diff.folded', 'differential', {limits: {maxLineChars: 8}}),
  ).rejects.toThrow(/line size/)
  const controller = new AbortController()
  controller.abort()
  await expect(
    importTextProfileStream(stream(), 'x.diff.folded', 'differential', {signal: controller.signal}),
  ).rejects.toThrow(/cancelled/)
})

test('plain/gzip differential Files stream without reading the whole body and preserve both columns', async () => {
  for (const gzip of [false, true]) {
    const name = `two.diff.folded${gzip ? '.gz' : ''}`
    const bytes = new TextEncoder().encode(text)
    const file = new File([gzip ? new Uint8Array(zlib.gzipSync(bytes)) : bytes], name)
    const fullRead = jest.spyOn(file, 'arrayBuffer')
    const group = (await tryImportTextProfile(file, name))!
    const expected = importFromBGDifferential(new StringBackedTextFileContent(text), name)!
    expect(exportProfileGroup(group)).toEqual(exportProfileGroup(expected))
    expect(fullRead).not.toHaveBeenCalled()
    fullRead.mockRestore()
  }
})

test('actual worker processing preserves both contribution profiles through snapshots', async () => {
  const response = await processTraceInWorker(
    {
      name: 'worker.diff.folded.gz',
      input: new File(
        [new Uint8Array(zlib.gzipSync(new TextEncoder().encode(text)))],
        'worker.diff.folded.gz',
      ),
    },
    () => {},
  )
  expect(response.type).toBe('result')
  if (response.type !== 'result') throw new Error('Expected worker result')
  expect(response.group.profiles).toHaveLength(2)
  const {Profile} = await import('../lib/profile')
  const profiles = await Promise.all(
    response.group.profiles.map(snapshot => Profile.fromSnapshot(snapshot)),
  )
  expect(profiles.map(profile => profile.getTotalWeight())).toEqual([10.5, 13.25])
  expect(profiles.every(profile => !profile.isChronological())).toBe(true)
  const comparison = await compareProfiles(profiles[0], profiles[1], {mode: 'absolute'})
  expect(comparison.nodes.find(node => node.frame?.name === 'removed')!.selfDelta).toBe(-2)
})
