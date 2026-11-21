import JSZip from 'jszip'
import * as pako from 'pako'
import fs from 'fs'
import {
  importFromJavaThreadDumpZip,
  checkJavaThreadDumpZipFileSize,
  JAVA_DUMP_ZIP_LIMITS,
} from './java-thread-dump-zip'
import {exportProfileGroup} from '../lib/file-format'

const dump = (method: string) =>
  `Full thread dump OpenJDK VM:\n"main" #1 prio=5 tid=0x1 nid=1 runnable\n    at app.Main.${method}(Main.java:20)\n`
async function archive(
  files: Record<string, string | Uint8Array>,
  compression: 'STORE' | 'DEFLATE' = 'DEFLATE',
  streamFiles = false,
) {
  const zip = new JSZip()
  for (const name of Object.keys(files)) zip.file(name, files[name], {createFolders: false})
  return zip.generateAsync({type: 'arraybuffer', compression, streamFiles})
}
function central(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const end = buffer.byteLength - 22
  return {view, offset: view.getUint32(end + 16, true)}
}
function setSize(buffer: ArrayBuffer, size: number) {
  const {view, offset} = central(buffer)
  view.setUint32(22, size, true)
  view.setUint32(offset + 24, size, true)
}

test('STORE, DEFLATE and descriptors combine snapshots in deterministic filename order', async () => {
  for (const compression of ['STORE', 'DEFLATE'] as const)
    for (const descriptors of [false, true]) {
      const input = await archive(
        {'2.jstack': dump('second'), '1.jstack': dump('first'), 'notes.txt': 'not a profile'},
        compression,
        descriptors,
      )
      const group = (await importFromJavaThreadDumpZip(input, 'capture.zip'))!
      expect(group.profiles.length).toBe(1)
      const profile = group.profiles[0]
      expect(profile.getName()).toBe('main (#1)')
      expect(profile.getTotalWeight()).toBe(2)
      expect(profile.isChronological()).toBe(false)
      expect(profile.getWeightUnit()).toBe('none')
      expect([...profile.getFrames()].map(f => f.name)).toEqual([
        'app.Main.first',
        'app.Main.second',
      ])
      expect(exportProfileGroup(group).profiles.length).toBe(1)
    }
})

test('300 jstack snapshots from the upstream shell example fit the bounded entry policy', async () => {
  const files: Record<string, string> = {}
  for (let i = 1; i <= 300; i++) files[`${i}.jstack`] = dump('run')
  const group = await importFromJavaThreadDumpZip(await archive(files), '300-snapshots.zip')
  expect(group!.profiles[0].getTotalWeight()).toBe(300)
})

test('unsigned descriptors work even when their CRC bytes equal the optional signature', async () => {
  const signed = await archive({'a.jstack': dump('a')}, 'DEFLATE', true)
  const c = central(signed)
  const descriptor = 30 + 'a.jstack'.length + c.view.getUint32(c.offset + 20, true)
  const bytes = new Uint8Array(signed.byteLength - 4)
  bytes.set(new Uint8Array(signed, 0, descriptor))
  bytes.set(new Uint8Array(signed, descriptor + 4), descriptor)
  new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, c.offset - 4, true)
  expect(
    (await importFromJavaThreadDumpZip(bytes.buffer, 'x.zip'))!.profiles[0].getTotalWeight(),
  ).toBe(1)
  const unsigned = central(bytes.buffer)
  unsigned.view.setUint32(unsigned.offset + 16, 0x08074b50, true)
  unsigned.view.setUint32(descriptor, 0x08074b50, true)
  // Descriptor parsing succeeds; only the deliberately false checksum fails.
  await expect(importFromJavaThreadDumpZip(bytes.buffer, 'x.zip')).rejects.toThrow('CRC32 mismatch')
})

test('empty DEFLATE directory streams are validated without becoming profile input', async () => {
  const zip = new JSZip()
  zip.folder('captures')
  const original = await zip.generateAsync({type: 'arraybuffer'})
  const c = central(original),
    data = 30 + 'captures/'.length
  const packed = pako.deflateRaw(new Uint8Array(0))
  const bytes = new Uint8Array(original.byteLength + packed.length)
  bytes.set(new Uint8Array(original, 0, data))
  bytes.set(packed, data)
  bytes.set(new Uint8Array(original, data), data + packed.length)
  const view = new DataView(bytes.buffer),
    offset = c.offset + packed.length
  view.setUint16(8, 8, true)
  view.setUint32(18, packed.length, true)
  view.setUint16(offset + 10, 8, true)
  view.setUint32(offset + 20, packed.length, true)
  view.setUint32(bytes.length - 22 + 16, offset, true)
  await expect(importFromJavaThreadDumpZip(bytes.buffer, 'x.zip')).rejects.toThrow(
    'contains no UTF-8 Java',
  )
})

test('directory entries are skipped and UTF-8 source symbols survive output chunk boundaries', async () => {
  const zip = new JSZip()
  zip.folder('captures')
  zip.file('captures/a.jstack', ' '.repeat(16300) + '\n' + dump('rún_雪'))
  const group = await importFromJavaThreadDumpZip(
    await zip.generateAsync({type: 'arraybuffer', compression: 'DEFLATE'}),
    'x.zip',
  )
  expect([...group!.profiles[0].getFrames()][0].name).toBe('app.Main.rún_雪')
})

test('compressed, entry-count, declared expansion, filename and depth caps reject before inflating', async () => {
  const input = await archive({'a.jstack': dump('a'), 'b.jstack': dump('b')})
  for (const limits of [
    {maxCompressedBytes: 20},
    {maxEntries: 1},
    {maxEntryBytes: 10},
    {maxTotalBytes: 150},
    {maxNameBytes: 2},
  ])
    await expect(importFromJavaThreadDumpZip(input, 'x.zip', {limits})).rejects.toThrow(
      /limit|name/,
    )
  await expect(
    importFromJavaThreadDumpZip(await archive({'a/b/c.jstack': dump('a')}), 'x.zip', {
      limits: {maxDepth: 2},
    }),
  ).rejects.toThrow('path')
})

test('unsafe and ambiguous paths are rejected without disk extraction', async () => {
  for (const name of ['../a.jstack', '/a.jstack', 'a//b.jstack', 'C:/a.jstack', 'a\\b.jstack'])
    await expect(
      importFromJavaThreadDumpZip(await archive({[name]: dump('a')}), 'x.zip'),
    ).rejects.toThrow('path')
  await expect(
    importFromJavaThreadDumpZip(
      await archive({'A.jstack': dump('a'), 'a.jstack': dump('b')}),
      'x.zip',
    ),
  ).rejects.toThrow('ambiguous')
  await expect(
    importFromJavaThreadDumpZip(
      await archive({'a.jstack': dump('a'), 'a.jstack/b.jstack': dump('b')}),
      'x.zip',
    ),
  ).rejects.toThrow('parent directory')
})

test('encrypted, inconsistent local headers and symlink entries are rejected', async () => {
  const input = await archive({'a.jstack': dump('a')})
  const encrypted = input.slice(0),
    c = central(encrypted)
  c.view.setUint16(6, 1, true)
  c.view.setUint16(c.offset + 8, 1, true)
  await expect(importFromJavaThreadDumpZip(encrypted, 'x.zip')).rejects.toThrow('encrypted')
  const mismatch = input.slice(0)
  new Uint8Array(mismatch)[30] ^= 1
  await expect(importFromJavaThreadDumpZip(mismatch, 'x.zip')).rejects.toThrow('paths disagree')
  const symlink = input.slice(0),
    s = central(symlink)
  s.view.setUint32(s.offset + 38, 0xa1ff0000, true)
  await expect(importFromJavaThreadDumpZip(symlink, 'x.zip')).rejects.toThrow('special files')
})

test('actual expansion stops in onData even when central/local sizes lie about a compressed bomb', async () => {
  const input = await archive({'bomb.bin': new Uint8Array(1024 * 1024)})
  setSize(input, 64)
  const push = jest.spyOn(pako.Inflate.prototype, 'push')
  try {
    await expect(
      importFromJavaThreadDumpZip(input, 'x.zip', {
        limits: {maxEntryBytes: 128, maxTotalBytes: 256},
      }),
    ).rejects.toThrow('actual decompressed bytes')
    expect(push).toHaveBeenCalledTimes(1)
  } finally {
    push.mockRestore()
  }
})

test('CRC corruption, truncated archives and damaged DEFLATE streams fail without a partial group', async () => {
  const input = await archive({'a.jstack': dump('a')})
  const corrupt = input.slice(0),
    c = central(corrupt)
  c.view.setUint32(14, 123, true)
  c.view.setUint32(c.offset + 16, 123, true)
  await expect(importFromJavaThreadDumpZip(corrupt, 'x.zip')).rejects.toThrow('CRC32')
  await expect(
    importFromJavaThreadDumpZip(input.slice(0, input.byteLength - 1), 'x.zip'),
  ).rejects.toThrow('end record')
  const damaged = input.slice(0)
  new Uint8Array(damaged)[30 + 'a.jstack'.length] = 255
  await expect(importFromJavaThreadDumpZip(damaged, 'x.zip')).rejects.toThrow(
    /DEFLATE|CRC32|decompressed/,
  )
})

test('entry boundary validation and bounded UTF-8 lines reject malformed or unrelated input', async () => {
  await expect(
    importFromJavaThreadDumpZip(await archive({'a.jstack': 'not a dump'}), 'x.zip'),
  ).rejects.toThrow('Full thread dump')
  await expect(
    importFromJavaThreadDumpZip(await archive({'README.txt': 'ordinary notes'}), 'x.zip'),
  ).rejects.toThrow('no UTF-8 Java')
  await expect(
    importFromJavaThreadDumpZip(await archive({'a.txt': 'x'.repeat(500)}), 'x.zip', {
      limits: {maxLineChars: 128},
    }),
  ).rejects.toThrow('text line')
  const malformed = dump('a') + '    at missing-location\n'
  await expect(
    importFromJavaThreadDumpZip(await archive({'a.jstack': malformed}), 'x.zip'),
  ).rejects.toThrow('Invalid Java stack frame')
})

test('cancellation is observed before reading and after yielding during decompression', async () => {
  const input = await archive(
    {'a.bin': new Uint8Array(1024 * 1024), 'b.jstack': dump('a')},
    'STORE',
  )
  const early = new AbortController()
  early.abort()
  await expect(
    importFromJavaThreadDumpZip(input, 'x.zip', {signal: early.signal}),
  ).rejects.toHaveProperty('name', 'AbortError')
  let now = 0
  const clock = jest.spyOn(performance, 'now')
  clock.mockImplementation(() => (now += 20))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 0)
  try {
    await expect(
      importFromJavaThreadDumpZip(input, 'x.zip', {signal: controller.signal}),
    ).rejects.toHaveProperty('name', 'AbortError')
  } finally {
    clearTimeout(timer)
    clock.mockRestore()
  }
})

test('oversized File preflight reads only four signature bytes and never materializes the body', async () => {
  const slice = jest.fn(() => ({arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer}))
  const file = {
    size: JAVA_DUMP_ZIP_LIMITS.maxCompressedBytes + 1,
    slice,
    arrayBuffer: jest.fn(),
  } as unknown as File
  await expect(checkJavaThreadDumpZipFileSize(file)).rejects.toThrow('compressed input')
  expect(slice).toHaveBeenCalledWith(0, 4)
  expect(file.arrayBuffer).not.toHaveBeenCalled()
})

test('checked-in synthetic ZIP imports directly', async () => {
  const bytes = fs.readFileSync('sample/profiles/java-thread-dump/synthetic.zip')
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  expect(
    (await importFromJavaThreadDumpZip(input, 'synthetic.zip'))!.profiles[0].getTotalWeight(),
  ).toBe(2)
})
