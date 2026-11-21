/** @jest-environment node */
import {CallTreeProfileBuilder, Profile, StackListProfileBuilder} from './profile'
import {exportProfileGroup} from './file-format'
import {ByteFormatter} from './value-formatters'
import {dumpProfile} from './test-utils'
import {snapshotTransferables} from './profile-snapshot'

test('worker snapshots preserve timing, recursive weights, source identity and aggregate metadata', async () => {
  const builder = new CallTreeProfileBuilder(15)
  const a = {key: 0, name: 'same', file: 'a.ts', line: 3, col: 2, color: '#8a2BE2'}
  const b = {key: '0', name: 'same', file: 'b.ts'}
  builder.enterFrame(a, 2)
  builder.enterFrame(a, 3)
  builder.enterFrame(b, 4)
  builder.leaveFrame(b, 6)
  builder.leaveFrame(a, 8)
  builder.leaveFrame(a, 11)
  const original = builder.build()
  original.setName('profile')
  original.setChronological(false)
  original.setDerived(true)
  original.setValueFormatter(new ByteFormatter())
  const snapshot = original.toSnapshot()
  const copy = structuredClone(snapshot, {
    transfer: snapshotTransferables({name: 'g', indexToView: 0, profiles: [snapshot]}),
  })
  expect(snapshot.appendNodes.byteLength).toBe(0)
  const restored = await Profile.fromSnapshot(copy, {yieldControl: () => Promise.resolve()})
  expect(dumpProfile(restored)).toEqual(dumpProfile(original))
  const group = (p: Profile) => ({name: 'g', indexToView: 0, profiles: [p]})
  expect(exportProfileGroup(group(restored))).toEqual(exportProfileGroup(group(original)))
  expect(restored.isChronological()).toBe(false)
  expect(restored.isDerived()).toBe(true)
  expect(restored.formatValue(1024)).toBe('1.00 KB')
})

test('empty and deeply nested profiles hydrate without recursive traversal', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    Array.from({length: 20000}, (_, key) => ({key, name: `${key}`})),
    1,
  )
  for (const original of [builder.build(), new StackListProfileBuilder().build()]) {
    const restored = await Profile.fromSnapshot(original.toSnapshot(), {
      yieldControl: () => Promise.resolve(),
    })
    expect(restored.getTotalWeight()).toBe(original.getTotalWeight())
    expect(Array.from(restored.getCallEvents()).length).toBe(
      Array.from(original.getCallEvents()).length,
    )
  }
})

test('hydration cancellation and invalid transport references fail promptly', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 'a', name: 'a'}], 2)
  const data = builder.build().toSnapshot()
  const controller = new AbortController()
  await expect(
    Profile.fromSnapshot(data, {
      signal: controller.signal,
      yieldControl: async () => {
        controller.abort()
      },
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
  data.appendNodes[5] = 1 // A node cannot be its own parent.
  await expect(Profile.fromSnapshot(data)).rejects.toThrow('node reference')
})
