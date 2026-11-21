/** @jest-environment node */
import * as fs from 'fs'
import * as zlib from 'zlib'
import {exportProfileGroup} from '../lib/file-format'
import {importProfileGroupFromText, importProfilesFromArrayBuffer} from './index'
import {
  importDurationTraceStream,
  tryImportDurationTrace,
  TraceImportLimitError,
} from './streaming-trace'

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}
function source(text: string, size = 7, cancel = jest.fn()) {
  const data = new Uint8Array(bytes(text))
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === data.length) controller.close()
      else {
        controller.enqueue(data.subarray(offset, (offset += Math.min(size, data.length - offset))))
      }
    },
    cancel,
  })
}

test('streamed duration fixtures match the ordinary importer across tiny UTF-8 chunks', async () => {
  const directory = 'sample/profiles/trace-event'
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const text = fs.readFileSync(`${directory}/${file}`, 'utf8')
    const expected = await importProfileGroupFromText(file, text)
    const actual = await importDurationTraceStream(source(text), file)
    // Sample tables intentionally fall back to their original importer.
    if (file.includes('samples')) expect(actual).toBeNull()
    else {
      expect(actual).not.toBeNull()
      expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
    }
  }
})

test('BOM, whitespace, split escapes, duplicate argument keys and complete-event EOF stay compatible', async () => {
  const text = '\ufeff \n[{"ph":"X","ts":0,"dur":1,"name":"\\u00e9","args":{"x":1,"x":2}},'
  const expected = await importProfileGroupFromText('trace.json', text)
  const actual = await importDurationTraceStream(source(text, 1), 'trace.json')
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
})

test('streaming preserves ordering, late metadata, Hermes args, Unicode and trailing commas', async () => {
  const text = `{"metadata":{"unused":[1,2,3,]},"traceEvents":[
    {"ph":"X","name":"内😀\\\"","pid":1,"tid":2,"ts":110,"dur":2,"args":{"a":"[},]","__proto__":{"x":1}}},
    {"ph":"X","name":"outer","pid":1,"tid":2,"ts":100,"dur":20},
    {"ph":"M","name":"thread_name","pid":1,"tid":2,"args":{"name":"worker"}},
  ],"otherData":{"ignored":true,}}`
  const expected = await importProfileGroupFromText('trace.json', text)
  for (const chunk of [1, 2, 3, 64 * 1024]) {
    const actual = await importDurationTraceStream(source(text, chunk), 'trace.json')
    expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  }
})

test('gzip File and buffer imports stream without reading a whole File', async () => {
  const text = JSON.stringify([{ph: 'X', ts: 0, dur: 3, name: 'work'}])
  const compressed = zlib.gzipSync(text)
  const buffer = Uint8Array.from(compressed).buffer as ArrayBuffer
  const file = new File([buffer], 'capture.trace.gz')
  file.arrayBuffer = () => Promise.reject(new Error('whole-file read forbidden'))
  const expected = await importProfilesFromArrayBuffer('capture.trace.gz', buffer)
  for (const input of [file, buffer]) {
    const actual = await tryImportDurationTrace(input, file.name)
    expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  }
  expect(buffer.byteLength).toBe(compressed.length)
})

test('CPU profiles, sample tables, duplicate trace keys and late CPU markers fall back intact', async () => {
  for (const text of [
    '{"nodes":[],"samples":[]}',
    '{"traceEvents":[{"ph":"X","ts":0}],"samples":[],"stackFrames":{}}',
    '{"traceEvents":[{"ph":"X","ts":0}],"traceEvents":[]}',
    '[{"ph":"X","ts":0},{"ph":"P","name":"ProfileChunk"}]',
    '[{"ph":"X","ts":0},null]',
    '{"traceEvents":{}}',
  ])
    expect(await importDurationTraceStream(source(text), 'capture.json')).toBeNull()
  const cpu = fs.readFileSync('sample/profiles/Chrome/65/simple.cpuprofile', 'utf8')
  expect(await tryImportDurationTrace(bytes(cpu), 'capture.cpuprofile')).toBeNull()
  expect(await tryImportDurationTrace(bytes(cpu), 'capture.json')).toBeNull()
})

test('resource limits reject rather than silently truncating or retrying the full importer', async () => {
  const event = '{"ph":"X","ts":0,"dur":1,"name":"work"}'
  const text = `[${event},${event}]`
  for (const limits of [
    {maxBytes: 10},
    {maxPendingBytes: 10},
    {maxRetainedBytes: 10},
    {maxEvents: 1},
    {maxDepth: 1},
  ]) {
    const cancel = jest.fn()
    await expect(
      importDurationTraceStream(source(text, 1, cancel), 'trace.json', {limits}),
    ).rejects.toBeInstanceOf(TraceImportLimitError)
    expect(cancel).toHaveBeenCalled()
  }
  // A single upstream chunk is also split before tokenization/budget checks.
  await expect(
    importDurationTraceStream(source(text, text.length), 'trace.json', {limits: {maxBytes: 10}}),
  ).rejects.toBeInstanceOf(TraceImportLimitError)
})

test('ignored payloads do not consume the retained-event budget', async () => {
  const work = {ph: 'X', ts: 0, dur: 5, name: 'work'}
  const ignored = {ph: 'Z', ts: 1, args: {unused: 'x'.repeat(500)}}
  const text = JSON.stringify([work, ...Array(5000).fill(ignored)])
  const group = await importDurationTraceStream(source(text, 65536), 'trace.json', {
    limits: {maxRetainedBytes: 256},
  })
  expect(group!.profiles[0].getTotalWeight()).toBe(5)
  const expected = await importProfileGroupFromText('trace.json', text)
  expect(exportProfileGroup(group!)).toEqual(exportProfileGroup(expected!))
})

test('abort interrupts a blocked stream read and releases its lock', async () => {
  const controller = new AbortController()
  const cancel = jest.fn()
  const stream = new ReadableStream<Uint8Array>({cancel})
  const result = importDurationTraceStream(stream, 'trace.json', {signal: controller.signal})
  controller.abort()
  await expect(result).rejects.toMatchObject({name: 'AbortError'})
  expect(cancel).toHaveBeenCalled()
  expect(stream.locked).toBe(false)
})

test('abort in the last progress callback prevents building a profile', async () => {
  const controller = new AbortController()
  await expect(
    importDurationTraceStream(source('[{"ph":"X","ts":0,"dur":1}]'), 'trace.json', {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
})

test('an uncooperative source cancellation cannot hide a limit failure', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes('[{"ph":"X","ts":0}]')))
    },
    cancel: () => new Promise(() => {}),
  })
  await expect(
    importDurationTraceStream(stream, 'trace.json', {limits: {maxBytes: 1}}),
  ).rejects.toBeInstanceOf(TraceImportLimitError)
  expect(stream.locked).toBe(false)
})

test('truncated values and corrupt gzip fail without producing partial profiles', async () => {
  await expect(
    importDurationTraceStream(source('[{"ph":"X","ts":0,"name":"unterminated'), 'trace.json'),
  ).rejects.toThrow()
  await expect(
    importDurationTraceStream(source('{"traceEvents":[{"ph":"X","ts":0}]'), 'trace.json'),
  ).rejects.toThrow('Incomplete')
  await expect(
    tryImportDurationTrace(Uint8Array.from([0x1f, 0x8b, 0, 0]).buffer, 'capture.trace.gz'),
  ).rejects.toThrow()
})

test('native event framing preserves complex arguments at every small chunk size', async () => {
  const text = JSON.stringify({
    otherData: {nested: [{ph: 'X', ts: 99, name: 'not an event'}]},
    traceEvents: [
      {
        ph: 'X',
        ts: -1.2e-5,
        dur: 1.7,
        name: '😀\\"{[]}',
        args: {array: [null, {}, [1, -0.25e6, 'é\\']], text: '}]'},
      },
      {ph: 'X', ts: 10, dur: 1, name: 'second'},
    ],
    metadata: {later: {nested: [1, 2]}},
  })
  const expected = exportProfileGroup((await importProfileGroupFromText('trace.json', text))!)
  for (let size = 1; size <= 41; size++) {
    const actual = await importDurationTraceStream(source(text, size), 'trace.json')
    expect(exportProfileGroup(actual!)).toEqual(expected)
  }
})

test('large cross-chunk records preserve UTF-8 and reject unfinished later events', async () => {
  const text = JSON.stringify([{ph: 'X', ts: 0, dur: 1, args: {text: 'é😀'.repeat(30000)}}])
  const expected = await importProfileGroupFromText('trace.json', text)
  const actual = await importDurationTraceStream(source(text, 65536), 'trace.json')
  expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  await expect(
    importDurationTraceStream(source('[{"ph":"X","ts":0},{"ph":'), 'trace.json'),
  ).rejects.toThrow('Incomplete')
})

test('native record parsing still rejects invalid record and outer-document grammar', async () => {
  for (const text of [
    '[{"ph":"X","ts":01}]',
    '[{"ph":"X","ts":0 "dur":1}]',
    '[{"ph":"X","ts":0} {"ph":"X","ts":1}]',
    '[{"ph":"X","ts":0,"args":[}}]',
    '{"traceEvents":[{"ph":"X","ts":0}] "otherData":{}}',
  ])
    await expect(importDurationTraceStream(source(text, 3), 'trace.json')).rejects.toThrow()
})

test('instant metadata uses its own bounded collector instead of retaining raw events under duration budget', async () => {
  const work = {ph: 'X', ts: 0, dur: 10, name: 'work'}
  for (const count of [100, 5000]) {
    const marker = {ph: 'i', ts: 1, name: 'mark', args: {text: 'x'.repeat(1000)}}
    const text = JSON.stringify([work, ...new Array(count).fill(marker)])
    const expected = (await importProfileGroupFromText('mixed.json', text))!
    const actual = (await importDurationTraceStream(source(text, 65536), 'mixed.json', {
      limits: {maxRetainedBytes: 256},
    }))!
    expect(actual.profiles[0].getTotalWeight()).toBe(10)
    expect(exportProfileGroup(actual)).toEqual(exportProfileGroup(expected))
    if (count === 100) expect(actual.instantTracks![0].times).toHaveLength(100)
    else {
      expect(actual.instantTracks).toBeUndefined()
      expect(actual.instantEventOmission).toEqual({count, reason: 'metadata-limit'})
    }
  }
})

test('first instant preserves Hermes discrimination while later CPU payloads override deferred marker errors', async () => {
  const args = {
    line: 7,
    column: 2,
    name: 'f',
    category: 'js',
    url: 'app.js',
    params: '',
    allocatedCategory: '',
    allocatedName: '',
  }
  const text = JSON.stringify([
    {ph: 'i', ts: 1, name: 'mark', args},
    {ph: 'X', ts: 2, dur: 3, name: 'f', args},
  ])
  const expected = (await importProfileGroupFromText('hermes.json', text))!
  const actual = (await importDurationTraceStream(source(text), 'hermes.json'))!
  expect(exportProfileGroup(actual)).toEqual(exportProfileGroup(expected))
  expect(Array.from(actual.profiles[0].getFrames())[0]).toMatchObject({file: 'app.js', line: 7})
  const cpu = JSON.stringify([
    {ph: 'i', ts: 1, name: 'invalid', s: 'bad'},
    {ph: 'P', name: 'ProfileChunk'},
  ])
  expect(await importDurationTraceStream(source(cpu), 'cpu.json')).toBeNull()
  const native = '{"traceEvents":[{"ph":"i","ts":1,"name":"invalid","s":"bad"}],"samples":[]}'
  expect(await importDurationTraceStream(source(native), 'samples.json')).toBeNull()
})
