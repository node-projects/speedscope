/** @jest-environment node */
import {CallTreeProfileBuilder, Profile, TimelineOrigin} from './profile'
import {TimeFormatter, ByteFormatter} from './value-formatters'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {exportProfileGroupToBlob} from './profile-export'
import {FileFormat} from './file-format-spec'
import {snapshotTransferables} from './profile-snapshot'
import {combineProfiles, cropProfile, invertProfile} from './profile-transformations'

function profile() {
  const builder = new CallTreeProfileBuilder(100)
  builder.setValueFormatter(new TimeFormatter('microseconds'))
  builder.enterFrame({key: 'f', name: 'work', file: 'min.js'}, 10)
  builder.leaveFrame({key: 'f', name: 'work'}, 90)
  return builder.build()
}
function native(timeline?: TimelineOrigin): FileFormat.File {
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {frames: [{name: 'work'}]},
    profiles: [
      {
        name: 'native',
        type: FileFormat.ProfileType.EVENTED,
        unit: 'microseconds',
        startValue: 1000000000000000,
        endValue: 1000000000000100,
        events: [
          {type: FileFormat.EventType.OPEN_FRAME, frame: 0, at: 1000000000000010},
          {type: FileFormat.EventType.CLOSE_FRAME, frame: 0, at: 1000000000000090},
        ],
        ...(timeline === undefined ? {} : {timeline}),
      },
    ],
  }
}
test('origin uses immutable bounded metadata and has no implicit default', () => {
  const input = profile()
  expect(input.getTimelineOrigin()).toBeUndefined()
  const origin = {clock: 'trace-event:wall', start: -123.5}
  input.setTimelineOrigin(origin)
  origin.start = 99
  expect(input.getTimelineOrigin()).toEqual({clock: 'trace-event:wall', start: -123.5})
  expect(Object.isFrozen(input.getTimelineOrigin())).toBe(true)
  input.setTimelineOrigin(undefined)
  expect(input.getTimelineOrigin()).toBeUndefined()
})

test('origin is rejected for malformed metadata or profiles without an original time axis', () => {
  for (const origin of [
    null,
    {},
    {clock: '', start: 0},
    {clock: ' x', start: 0},
    {clock: 'x\n', start: 0},
    {clock: 'x'.repeat(129), start: 0},
    {clock: 1, start: 0},
    {clock: 'x', start: NaN},
    {clock: 'x', start: Infinity},
    {clock: 'x', start: '1'},
  ]) {
    expect(() => profile().setTimelineOrigin(origin as TimelineOrigin)).toThrow(
      'Invalid timeline origin',
    )
  }
  for (const kind of ['aggregate', 'bytes', 'derived']) {
    const input = profile()
    if (kind === 'aggregate') input.setChronological(false)
    if (kind === 'bytes') input.setValueFormatter(new ByteFormatter())
    if (kind === 'derived') input.setDerived(true)
    expect(() => input.setTimelineOrigin({clock: 'test', start: 0})).toThrow(
      'original chronological',
    )
  }
})

test('changing unit, chronology or derivation clears origin instead of retaining stale alignment', () => {
  for (const change of [
    (input: Profile) => input.setChronological(false),
    (input: Profile) => input.setDerived(true),
    (input: Profile) => input.setValueFormatter(new TimeFormatter('seconds')),
  ]) {
    const input = profile()
    input.setTimelineOrigin({clock: 'clock', start: 50})
    change(input)
    expect(input.getTimelineOrigin()).toBeUndefined()
  }
  const input = profile()
  input.setTimelineOrigin({clock: 'clock', start: 50})
  input.setValueFormatter(new TimeFormatter('microseconds'))
  expect(input.getTimelineOrigin()?.start).toBe(50)
})

test('native explicit metadata survives large nonzero startValue normalization without double adjustment', async () => {
  const input = native({clock: 'trace-event:wall', start: 987654321000000})
  const group = importSpeedscopeProfiles(input)
  const imported = group.profiles[0]
  expect(imported.getTimelineOrigin()).toEqual(input.profiles[0].timeline)
  expect(imported.getTotalWeight()).toBe(100)
  const exported = exportProfileGroup(group)
  expect(exported.profiles[0].startValue).toBe(0)
  expect(exported.profiles[0].timeline).toEqual(input.profiles[0].timeline)
  const blob = await exportProfileGroupToBlob(group)
  expect(JSON.parse(await blob.text())).toEqual(exported)
  const restored = importSpeedscopeProfiles(exported)
  expect(restored.profiles[0].getTimelineOrigin()).toEqual(imported.getTimelineOrigin())
  expect(restored.profiles[0].getTotalWeight()).toBe(100)
  const without = importSpeedscopeProfiles(native()).profiles[0]
  expect(without.getTimelineOrigin()).toBeUndefined()
  expect(
    exportProfileGroup({name: 'old', indexToView: 0, profiles: [without]}).profiles[0],
  ).not.toHaveProperty('timeline')
})

test('sampled native origins require explicit compatible metadata', () => {
  const data = native()
  data.profiles[0] = {
    type: FileFormat.ProfileType.SAMPLED,
    name: 'sampled',
    unit: 'seconds',
    startValue: 20,
    endValue: 22,
    samples: [[0]],
    weights: [2],
    timeline: {clock: 'sampling', start: 1000},
  }
  expect(importSpeedscopeProfiles(data).profiles[0].getTimelineOrigin()).toEqual({
    clock: 'sampling',
    start: 1000,
  })
  for (const changes of [
    {unit: 'none'},
    {isChronological: false},
    {isDerived: true},
    {timeline: null},
  ]) {
    const invalid = {
      ...data,
      profiles: [{...data.profiles[0], ...changes}],
    } as unknown as FileFormat.File
    expect(() => importSpeedscopeProfiles(invalid)).toThrow(/timeline|Timeline/)
  }
})

test('worker transfer and source-map style clones retain independent validated origin metadata', async () => {
  const original = profile()
  original.setTimelineOrigin({clock: 'worker-clock', start: 1e15})
  const snapshot = original.toSnapshot()
  const transferred = structuredClone(snapshot, {
    transfer: snapshotTransferables({name: 'test', indexToView: 0, profiles: [snapshot]}),
  })
  const restored = await Profile.fromSnapshot(transferred, {yieldControl: async () => {}})
  expect(restored.getTimelineOrigin()).toEqual(original.getTimelineOrigin())
  const clone = restored.shallowClone()
  clone.setTimelineOrigin({clock: 'different', start: 123})
  clone.remapSymbols(() => ({name: 'mapped'}))
  expect(restored.getTimelineOrigin()).toEqual({clock: 'worker-clock', start: 1e15})
  expect(clone.getTimelineOrigin()).toEqual({clock: 'different', start: 123})
  for (const changes of [
    {chronological: false},
    {unit: 'bytes'},
    {derived: true},
    {timeline: {clock: '', start: 0}},
  ]) {
    await expect(
      Profile.fromSnapshot({...transferred, ...changes} as typeof transferred, {
        yieldControl: async () => {},
      }),
    ).rejects.toThrow(/timeline|Timeline/)
  }
})

test('aggregate and cropped transformations do not invent a trustworthy origin', () => {
  const input = profile()
  input.setTimelineOrigin({clock: 'clock', start: 1e15})
  for (const transformed of [
    cropProfile(input, 20, 80),
    combineProfiles([input]),
    invertProfile(input),
    input.getProfileWithRecursionFlattened(),
  ])
    expect(transformed.getTimelineOrigin()).toBeUndefined()
  expect(input.getTimelineOrigin()).toEqual({clock: 'clock', start: 1e15})
})
