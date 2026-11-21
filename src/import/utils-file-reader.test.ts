import * as pako from 'pako'
import {MaybeCompressedDataReader} from './utils'

test('FileReader cancellation aborts I/O without producing an unhandled body rejection', async () => {
  const abort = jest.spyOn(FileReader.prototype, 'abort')
  const controller = new AbortController()
  try {
    const file = new File([new Uint8Array(100000)], 'large.bin')
    const reader = MaybeCompressedDataReader.fromFile(file, {signal: controller.signal})
    controller.abort()
    await expect(reader.readAsArrayBuffer()).rejects.toMatchObject({name: 'AbortError'})
    expect(abort).toHaveBeenCalledTimes(1)
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    abort.mockRestore()
  }
})

test('File-based generic fallback applies the same expansion limit and cached successful output', async () => {
  const file = new File([new Uint8Array(pako.gzip('x'.repeat(20000)))], 'native.json.gz')
  await expect(
    MaybeCompressedDataReader.fromFile(file, {maxExpandedBytes: 1024}).readAsArrayBuffer(),
  ).rejects.toThrow(/expanded-byte limit/)
  const reader = MaybeCompressedDataReader.fromFile(file)
  const decoded = await reader.readAsArrayBuffer()
  expect(decoded.byteLength).toBe(20000)
  expect(await reader.readAsArrayBuffer()).toBe(decoded)
})

test('a synchronous FileReader start failure removes listeners and preserves the original error', async () => {
  const controller = new AbortController()
  const failure = new DOMException('Read could not start', 'NotReadableError')
  const read = jest.spyOn(FileReader.prototype, 'readAsArrayBuffer')
  read.mockImplementation(() => {
    throw failure
  })
  const abort = jest.spyOn(FileReader.prototype, 'abort')
  const remove = jest.spyOn(controller.signal, 'removeEventListener')
  const removeReader = jest.spyOn(FileReader.prototype, 'removeEventListener')
  try {
    const reader = MaybeCompressedDataReader.fromFile(new File(['data'], 'file.txt'), {
      signal: controller.signal,
    })
    await expect(reader.readAsArrayBuffer()).rejects.toBe(failure)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(removeReader).toHaveBeenCalledWith('loadend', expect.any(Function))
    controller.abort()
    expect(abort).not.toHaveBeenCalled()
  } finally {
    read.mockRestore()
    abort.mockRestore()
    remove.mockRestore()
    removeReader.mockRestore()
  }
})
