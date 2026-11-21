/** @jest-environment node */

import {exportProfileGroupToBlob, ExportProgress} from './profile-export'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {CallTreeProfileBuilder, ProfileGroup, StackListProfileBuilder} from './profile'

function group(): ProfileGroup {
  const builder = new CallTreeProfileBuilder(12)
  const frame = {
    key: 'quoted',
    name: 'a"\\\n😀',
    file: 'src/文件.ts',
    line: 3,
    col: 2,
    color: '#8a2BE2',
  }
  builder.enterFrame(frame, 2)
  builder.enterFrame(frame, 4)
  builder.leaveFrame(frame, 5)
  builder.leaveFrame(frame, 9)
  const empty = new StackListProfileBuilder().build()
  empty.setChronological(false)
  empty.setDerived(true)
  builder.setName('nested')
  return {name: 'profile"😀', indexToView: 1, profiles: [builder.build(), empty]}
}

test('chunked export matches existing serialization including idle ranges and escaped metadata', async () => {
  const input = group()
  const progress: ExportProgress[] = []
  const blob = await exportProfileGroupToBlob(input, {onProgress: p => progress.push(p)})
  const serialized = JSON.parse(await blob.text())
  expect(serialized).toEqual(exportProfileGroup(input))
  expect(exportProfileGroup(importSpeedscopeProfiles(serialized))).toEqual(serialized)
  expect(progress[progress.length - 1]).toEqual({
    profilesCompleted: 2,
    profileCount: 2,
    eventsWritten: 4,
    frameCount: 1,
    framesWritten: 1,
  })
  expect(blob.type).toBe('application/json')
})

test('wide exports yield and cancel mid-profile before visiting the remaining events', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 10000; i++) builder.appendSampleWithWeight([{key: i, name: `${i}`}], 1)
  const profile = builder.build()
  const controller = new AbortController()
  const progress: ExportProgress[] = []
  let turns = 0
  const result = exportProfileGroupToBlob(
    {name: 'wide', indexToView: 0, profiles: [profile]},
    {
      signal: controller.signal,
      onProgress: p => progress.push(p),
      yieldControl: async () => {
        if (++turns === 2) controller.abort()
      },
    },
  )
  await expect(result).rejects.toMatchObject({name: 'AbortError'})
  expect(progress[1].eventsWritten).toBe(16384)
  expect(progress[1].profilesCompleted).toBe(0)
})

test('already-cancelled exports do no traversal', async () => {
  const input = group()
  const calls = jest.spyOn(input.profiles[0], 'getCallEvents')
  const controller = new AbortController()
  controller.abort()
  await expect(exportProfileGroupToBlob(input, {signal: controller.signal})).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(calls).not.toHaveBeenCalled()
})

test('native message scheduling can be cancelled between event batches', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 10000; i++) builder.appendSampleWithWeight([{key: i, name: `${i}`}], 1)
  const controller = new AbortController()
  await expect(
    exportProfileGroupToBlob(
      {name: 'wide', indexToView: 0, profiles: [builder.build()]},
      {
        signal: controller.signal,
        onProgress: p => {
          if (p.eventsWritten > 0) controller.abort()
        },
      },
    ),
  ).rejects.toMatchObject({name: 'AbortError'})
})

test('export falls back to timers when MessageChannel is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel')!
  Object.defineProperty(globalThis, 'MessageChannel', {configurable: true, value: undefined})
  try {
    const input = group()
    expect(JSON.parse(await (await exportProfileGroupToBlob(input)).text())).toEqual(
      exportProfileGroup(input),
    )
  } finally {
    Object.defineProperty(globalThis, 'MessageChannel', descriptor)
  }
})

test('cancellation while writing source frames rejects rather than returning a partial file', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 5000; i++) builder.appendSampleWithWeight([{key: i, name: `${i}`}], 1)
  const controller = new AbortController()
  const result = exportProfileGroupToBlob(
    {name: 'wide', indexToView: 0, profiles: [builder.build()]},
    {
      signal: controller.signal,
      yieldControl: () => Promise.resolve(),
      onProgress: p => {
        if (p.framesWritten === 4096) controller.abort()
      },
    },
  )
  await expect(result).rejects.toMatchObject({name: 'AbortError'})
})

test('large exports cross event and frame batches and retain frame identity', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 5000; i++) builder.appendSampleWithWeight([{key: i, name: 'same name'}], 1)
  const input = {name: 'wide', indexToView: 0, profiles: [builder.build()]}
  const progress: ExportProgress[] = []
  const serialized = JSON.parse(
    await (
      await exportProfileGroupToBlob(input, {
        yieldControl: () => Promise.resolve(),
        onProgress: p => progress.push(p),
      })
    ).text(),
  )
  expect(serialized).toEqual(exportProfileGroup(input))
  expect(progress.some(p => p.framesWritten === 4096)).toBe(true)
  expect(serialized.shared.frames).toHaveLength(5000)
})
