/** @jest-environment node */
import * as pako from 'pako'
import {decompressProfileInput, GENERIC_DECOMPRESSION_LIMITS} from './bounded-decompression'
import {MaybeCompressedDataReader} from './utils'

const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer as ArrayBuffer
const input = new TextEncoder().encode('λ😀\r\n'.repeat(10000))
async function withoutNative(work: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream')!
  Object.defineProperty(globalThis, 'DecompressionStream', {configurable: true, value: undefined})
  try {
    await work()
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', descriptor)
  }
}
function randomBytes(length: number) {
  let seed = 42
  return Uint8Array.from({length}, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed >>> 24
  })
}

test('bounded native and fallback decoding preserve gzip/zlib bytes across compressed chunks', async () => {
  const raw = randomBytes(200000)
  for (const native of [true, false]) {
    const check = async () => {
      for (const original of [raw, input])
        for (const packed of [pako.gzip(original), pako.deflate(original)])
          expect(new Uint8Array(await decompressProfileInput(buffer(packed)))).toEqual(original)
    }
    if (native) await check()
    else await withoutNative(check)
  }
})

test('expansion limits fail in both codecs and a native limit never retries pako', async () => {
  const packed = buffer(pako.gzip(input))
  const native = jest.spyOn(require('pako'), 'Inflate')
  try {
    await expect(decompressProfileInput(packed, {maxExpandedBytes: 1024})).rejects.toThrow(
      /expanded-byte limit/,
    )
    expect(native).not.toHaveBeenCalled()
  } finally {
    native.mockRestore()
  }
  await withoutNative(async () => {
    for (const compressed of [pako.gzip(input), pako.deflate(input)])
      await expect(
        decompressProfileInput(buffer(compressed), {maxExpandedBytes: 1024}),
      ).rejects.toThrow(/expanded-byte limit/)
  })
})

test('native failure clears partial chunks before bounded fallback', async () => {
  const native = jest.spyOn(globalThis, 'DecompressionStream')
  native.mockImplementation(
    () =>
      new TransformStream({
        transform(_chunk, controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.error(new Error('Native decoder failed'))
        },
      }) as unknown as DecompressionStream,
  )
  try {
    expect(new Uint8Array(await decompressProfileInput(buffer(pako.gzip(input))))).toEqual(input)
    await expect(
      decompressProfileInput(buffer(pako.gzip(input)), {maxExpandedBytes: 1024}),
    ).rejects.toThrow(/expanded-byte limit/)
  } finally {
    native.mockRestore()
  }
})

test('concatenated gzip members share one expansion budget and truncated members are not accepted', async () => {
  const first = pako.gzip(new Uint8Array([1, 2, 3])),
    second = pako.gzip(new Uint8Array([4, 5, 6]))
  const packed = buffer(Uint8Array.from([...first, ...second]))
  for (const native of [true, false]) {
    const check = async () => {
      expect(new Uint8Array(await decompressProfileInput(packed))).toEqual(
        new Uint8Array([1, 2, 3, 4, 5, 6]),
      )
      await expect(decompressProfileInput(packed, {maxExpandedBytes: 5})).rejects.toThrow(
        /expanded-byte limit/,
      )
      const truncated = buffer(first.subarray(0, first.length - 4))
      expect(await decompressProfileInput(truncated)).toBe(truncated)
    }
    if (native) await check()
    else await withoutNative(check)
  }
})

test('abort before or during fallback never becomes raw-data success', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    decompressProfileInput(buffer(pako.gzip(input)), {signal: controller.signal}),
  ).rejects.toMatchObject({name: 'AbortError'})
  await withoutNative(async () => {
    const active = new AbortController()
    let now = 0
    const clock = jest.spyOn(performance, 'now')
    clock.mockImplementation(() => (now += 9))
    const timer = setTimeout(() => active.abort(), 0)
    try {
      await expect(
        decompressProfileInput(buffer(pako.gzip(randomBytes(200000))), {signal: active.signal}),
      ).rejects.toMatchObject({name: 'AbortError'})
    } finally {
      clearTimeout(timer)
      clock.mockRestore()
    }
  })
})

test('lazy readers decode once and preserve plain/invalid input ownership', async () => {
  const native = jest.spyOn(globalThis, 'DecompressionStream')
  try {
    const reader = MaybeCompressedDataReader.fromArrayBuffer('data.gz', buffer(pako.gzip(input)))
    await reader.name()
    expect(native).not.toHaveBeenCalled()
    const first = await reader.readAsArrayBuffer()
    expect(await reader.readAsArrayBuffer()).toBe(first)
    expect(native).toHaveBeenCalledTimes(1)
    for (const raw of [
      new ArrayBuffer(0),
      buffer(input),
      buffer(new Uint8Array([0x1f, 0x8b, 0, 0])),
    ])
      expect(await decompressProfileInput(raw)).toBe(raw)
  } finally {
    native.mockRestore()
  }
  for (const maximum of [0, NaN, -1, 1.5, GENERIC_DECOMPRESSION_LIMITS.expandedBytes + 1])
    await expect(
      decompressProfileInput(new ArrayBuffer(0), {maxExpandedBytes: maximum}),
    ).rejects.toThrow(/Invalid generic/)
})

test('many tiny gzip members coalesce into exact output and share the byte limit', async () => {
  const member = pako.gzip(new Uint8Array([7]))
  const packed = new Uint8Array(member.length * 10000)
  for (let index = 0; index < 10000; index++) packed.set(member, index * member.length)
  await withoutNative(async () => {
    const decoded = await decompressProfileInput(packed.buffer, {
      maxExpandedBytes: 10000,
      yieldToMainThread: false,
    })
    expect(decoded.byteLength).toBe(10000)
    expect(Array.from(new Uint8Array(decoded))).toEqual(new Array(10000).fill(7))
    await expect(
      decompressProfileInput(packed.buffer, {maxExpandedBytes: 9999, yieldToMainThread: false}),
    ).rejects.toThrow('expanded-byte limit')
  })
})

test('native input feeding yields for cancellation even if empty members emit no output', async () => {
  const member = pako.gzip(new Uint8Array(0))
  const packed = new Uint8Array(member.length * 1000)
  for (let index = 0; index < 1000; index++) packed.set(member, index * member.length)
  const active = new AbortController()
  let now = 0
  const clock = jest.spyOn(performance, 'now')
  clock.mockImplementation(() => (now += 9))
  const fallback = jest.spyOn(require('pako'), 'Inflate')
  const timer = setTimeout(() => active.abort(), 0)
  try {
    await expect(
      decompressProfileInput(packed.buffer, {signal: active.signal}),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(fallback).not.toHaveBeenCalled()
  } finally {
    clearTimeout(timer)
    clock.mockRestore()
    fallback.mockRestore()
  }
})

test('explicit worker feeding does not schedule cooperative timers for empty gzip members', async () => {
  const packed = buffer(pako.gzip(new Uint8Array(0)))
  let now = 0
  const clock = jest.spyOn(performance, 'now')
  clock.mockImplementation(() => (now += 9))
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    const output = await decompressProfileInput(packed, {yieldToMainThread: false})
    expect(output.byteLength).toBe(0)
    expect(timer).not.toHaveBeenCalled()
  } finally {
    clock.mockRestore()
    timer.mockRestore()
  }
})

test('fallback trailing zero padding also yields for cancellation', async () => {
  const member = pako.gzip(new Uint8Array(0))
  const packed = new Uint8Array(member.length + 65536)
  packed.set(member)
  await withoutNative(async () => {
    const active = new AbortController()
    let ticks = 0
    const clock = jest.spyOn(performance, 'now')
    clock.mockImplementation(() => (++ticks <= 2 ? 0 : 9))
    const timer = setTimeout(() => active.abort(), 0)
    try {
      await expect(
        decompressProfileInput(packed.buffer, {signal: active.signal}),
      ).rejects.toMatchObject({name: 'AbortError'})
    } finally {
      clearTimeout(timer)
      clock.mockRestore()
    }
  })
})
