/** @jest-environment node */

import * as pako from 'pako'
import {
  BufferBackedTextFileContent,
  MaybeCompressedDataReader,
  withMockedFileChunkSizeForTests,
} from './utils'

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const text = '[{"name":"work","ph":"B","ts":1}]'

test('reads gzip with native decompression', async () => {
  expect(typeof DecompressionStream).toBe('function')
  const reader = MaybeCompressedDataReader.fromArrayBuffer('trace.gz', arrayBuffer(pako.gzip(text)))
  expect((await reader.readAsText()).parseAsJSON()).toEqual(JSON.parse(text))
})

test('reads gzip without native decompression', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream')!
  Object.defineProperty(globalThis, 'DecompressionStream', {configurable: true, value: undefined})
  try {
    const reader = MaybeCompressedDataReader.fromArrayBuffer(
      'trace.gz',
      arrayBuffer(pako.gzip(text)),
    )
    expect((await reader.readAsText()).parseAsJSON()).toEqual(JSON.parse(text))
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', descriptor)
  }
})

test('falls back when native decompression fails', async () => {
  const native = jest.spyOn(globalThis, 'DecompressionStream')
  native.mockImplementation(() => {
    throw new Error('Native gzip unavailable')
  })
  try {
    const reader = MaybeCompressedDataReader.fromArrayBuffer(
      'trace.gz',
      arrayBuffer(pako.gzip(text)),
    )
    expect((await reader.readAsText()).parseAsJSON()).toEqual(JSON.parse(text))
    expect(native).toHaveBeenCalledWith('gzip')
  } finally {
    native.mockRestore()
  }
})

test('still reads zlib and uncompressed input', async () => {
  for (const bytes of [pako.deflate(text), new TextEncoder().encode(text)]) {
    const reader = MaybeCompressedDataReader.fromArrayBuffer('trace', arrayBuffer(bytes))
    expect((await reader.readAsText()).parseAsJSON()).toEqual(JSON.parse(text))
  }
})

test('preserves invalid compressed input for format detection', async () => {
  const buffer = arrayBuffer(new Uint8Array([0x1f, 0x8b, 0, 0]))
  const reader = MaybeCompressedDataReader.fromArrayBuffer('invalid.gz', buffer)
  expect(await reader.readAsArrayBuffer()).toBe(buffer)
})

test('uses native JSON parsing across decoding chunks', async () => {
  await withMockedFileChunkSizeForTests(2, () => {
    const expected = [{name: 'Grüße 日本語'}]
    const content = new BufferBackedTextFileContent(
      arrayBuffer(new TextEncoder().encode(JSON.stringify(expected))),
    )
    const parse = jest.spyOn(JSON, 'parse')
    try {
      expect(content.parseAsJSON()).toEqual(expected)
      expect(parse).toHaveBeenCalledWith(JSON.stringify(expected))
    } finally {
      parse.mockRestore()
    }
  })
})

test('retains byte-array parsing when text exceeds the string limit', async () => {
  await withMockedFileChunkSizeForTests(2, () => {
    const content = new BufferBackedTextFileContent(arrayBuffer(new TextEncoder().encode('[1,2,')))
    const join = jest.spyOn(Array.prototype, 'join')
    join.mockImplementationOnce(() => {
      throw new RangeError('Invalid string length')
    })
    let parsed: any
    try {
      parsed = content.parseAsJSON()
    } finally {
      join.mockRestore()
    }
    expect(parsed).toEqual([1, 2])
  })
})
