/** @jest-environment node */

import * as pako from 'pako'
import {
  BufferBackedTextFileContent,
  MaybeCompressedDataReader,
  withMockedFileChunkSizeForTests,
  StringBackedTextFileContent,
} from './utils'

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const text = '[{"name":"work","ph":"B","ts":1}]'

test('line iterables preserve empty/CRLF/Unicode lines across byte boundaries and can be reused', async () => {
  for (const sampleText of ['', '\n', '\n\n', 'a\r\nb\n', 'α😀\n日本語\nlong line']) {
    for (const size of [1, 2, 3, 7]) {
      await withMockedFileChunkSizeForTests(size, () => {
        const content = new BufferBackedTextFileContent(
          arrayBuffer(new TextEncoder().encode(sampleText)),
        )
        for (const source of [content, new StringBackedTextFileContent(sampleText)]) {
          const lines = source.splitLines()
          expect([...lines]).toEqual(sampleText.split('\n'))
          expect([...lines]).toEqual(sampleText.split('\n'))
        }
      })
    }
  }
})

test('line iteration does not split the full input into an array', () => {
  const content = new StringBackedTextFileContent('line\n'.repeat(100000))
  const split = jest.spyOn(String.prototype, 'split')
  try {
    const iterator = content.splitLines()[Symbol.iterator]()
    expect(iterator.next().value).toBe('line')
    expect(split).not.toHaveBeenCalled()
  } finally {
    jest.restoreAllMocks()
  }
})

test('ASCII fallback decodes bounded pieces across chunk boundaries', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder')!
  Object.defineProperty(globalThis, 'TextDecoder', {configurable: true, value: undefined})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await withMockedFileChunkSizeForTests(10000, () => {
      const input = 'abc\n'.repeat(8000)
      const content = new BufferBackedTextFileContent(arrayBuffer(Buffer.from(input)))
      expect(Array.from(content.splitLines())).toEqual(input.split('\n'))
    })
  } finally {
    Object.defineProperty(globalThis, 'TextDecoder', descriptor)
    jest.restoreAllMocks()
  }
})

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

test('removes a V8 version warning before partial arrays in both parser paths', async () => {
  await withMockedFileChunkSizeForTests(2, () => {
    const warningText = ' \nTesting v8 version different from logging version\n[1,2,'
    const content = new BufferBackedTextFileContent(
      arrayBuffer(new TextEncoder().encode(warningText)),
    )
    expect(content.parseAsJSON()).toEqual([1, 2])
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
