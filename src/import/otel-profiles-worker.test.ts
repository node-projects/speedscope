/** @jest-environment node */
import {importFromOTELProfiles} from './otel-profiles'
import {importProfilesFromArrayBuffer} from './index'
import {processTraceInWorker} from './trace-worker'
import {exportProfileGroup} from '../lib/file-format'
import fs from 'fs'

function input(): any {
  const data = JSON.parse(fs.readFileSync('sample/profiles/otel-profiles/synthetic.json', 'utf8'))
  data.resourceProfiles[0].scopeProfiles[0].profiles[0].samples = Array.from(
    {length: 10000},
    () => ({stackIndex: 1, values: ['3']}),
  )
  return data
}

test('worker mode avoids timers and preserves main-thread import semantics', async () => {
  const data = input()
  const expected = await importFromOTELProfiles(data, 'large.json')
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    const actual = await importFromOTELProfiles(data, 'large.json', {yieldToMainThread: false})
    expect(timer).not.toHaveBeenCalled()
    expect(exportProfileGroup(actual)).toEqual(exportProfileGroup(expected))
    expect(actual.profiles[0].getTotalWeight()).toBe(30000)
  } finally {
    timer.mockRestore()
  }
})

test('ordinary worker pipeline propagates non-yielding mode through JSON fallback', async () => {
  const buffer = new TextEncoder().encode(JSON.stringify(input())).buffer as ArrayBuffer
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    const response = await processTraceInWorker({name: 'large-otel.json', input: buffer}, () => {})
    expect(timer).not.toHaveBeenCalled()
    if (response.type !== 'result') throw new Error('Expected worker result')
    expect(response.group.profiles[0].totalWeight).toBe(30000)
    expect(response.group.profiles[0].unit).toBe('nanoseconds')
  } finally {
    timer.mockRestore()
  }
})

test('main-thread fallback yields without an AbortSignal', async () => {
  const buffer = new TextEncoder().encode(JSON.stringify(input())).buffer as ArrayBuffer
  const timer = jest.spyOn(globalThis, 'setTimeout')
  try {
    const group = await importProfilesFromArrayBuffer('large-otel.json', buffer)
    expect(timer).toHaveBeenCalled()
    expect(group!.profiles[0].getTotalWeight()).toBe(30000)
  } finally {
    timer.mockRestore()
  }
})

test('explicit worker mode still checks an aborted signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    importFromOTELProfiles(input(), 'cancelled', {
      signal: controller.signal,
      yieldToMainThread: false,
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
})
