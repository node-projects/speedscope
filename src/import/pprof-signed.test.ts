import {perftools} from './profile.proto.js'
import Long from 'long'
import {importAsPprofProfileGroup, importAsPprofProfile} from './pprof'
import {compareProfiles} from '../lib/profile-comparison'
import {exportProfileGroup, importSpeedscopeProfiles} from '../lib/file-format'
import {importProfilesFromArrayBuffer} from './index'

function input(values: (number | Long)[], unit = 'bytes') {
  const bytes = perftools.profiles.Profile.encode({
    stringTable: ['', 'inuse_space', unit, 'work', 'main'],
    sampleType: [{type: 1, unit: 2}],
    function: [
      {id: 1, name: 3},
      {id: 2, name: 4},
    ],
    location: [
      {id: 1, line: [{functionId: 1}]},
      {id: 2, line: [{functionId: 2}]},
    ],
    sample: values.map(value => ({locationId: [1, 2], value: [value]})),
  }).finish()
  return Uint8Array.from(bytes).buffer as ArrayBuffer
}

test('negative Go heap values retain positive and negative contribution magnitudes (#370)', async () => {
  const buffer = input([-9, 12, -2, 0])
  const group = (await importProfilesFromArrayBuffer('delta.prof', buffer))!
  expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual([11, 12])
  expect(group.profiles.map(profile => profile.getWeightUnit())).toEqual(['bytes', 'bytes'])
  expect(group.profiles[0].getName()).toContain('Negative contributions')
  expect(group.profiles[1].getName()).toContain('Positive contributions')
  expect(group.profiles.every(profile => !profile.isChronological())).toBe(true)
  const comparison = await compareProfiles(group.profiles[0], group.profiles[1], {mode: 'absolute'})
  expect(comparison.root.totalDelta).toBe(1)
  expect(comparison.nodes.find(node => node.frame?.name === 'work')!.selfDelta).toBe(1)
  const exported = exportProfileGroup(group)
  expect(exportProfileGroup(importSpeedscopeProfiles(exported))).toEqual(exported)
  expect(() => importAsPprofProfile(buffer)).toThrow(/contribution-pair/)
})

test('all-negative values and exact cancellation stay representable without dropping samples', async () => {
  for (const [values, totals, delta] of [
    [[-7, -3], [10, 0], -10],
    [[-7, 7], [7, 7], 0],
  ] as [number[], number[], number][]) {
    const group = importAsPprofProfileGroup(input(values, 'nanoseconds'))!
    expect(group.profiles.map(profile => profile.getTotalWeight())).toEqual(totals)
    const comparison = await compareProfiles(group.profiles[0], group.profiles[1], {
      mode: 'absolute',
    })
    expect(comparison.root.totalDelta).toBe(delta)
    expect(comparison.nodes.find(node => node.frame?.name === 'work')!.selfDelta).toBe(delta)
  }
})

test('nonnegative pprof remains one ordinary profile and inexact integers fail explicitly', () => {
  expect(importAsPprofProfileGroup(input([1, 2, 0]))!.profiles).toHaveLength(1)
  expect(importAsPprofProfile(input([1, 2]))!.getTotalWeight()).toBe(3)
  expect(() => importAsPprofProfileGroup(input([Long.fromString('-9223372036854775808')]))).toThrow(
    /exact integer/,
  )
  expect(() => importAsPprofProfileGroup(input([Number.MAX_SAFE_INTEGER, 1]))).toThrow(
    /total weight/,
  )
})
