import {perftools} from './profile.proto.js'
import Long from 'long'
import {importAsPprofProfile} from './pprof'

function decode(profile: perftools.profiles.IProfile) {
  const bytes = perftools.profiles.Profile.encode(profile).finish()
  return importAsPprofProfile(Uint8Array.from(bytes).buffer as ArrayBuffer)!
}

test('preferred sample type compares protobuf integer values and defaults to the last when absent', () => {
  const input = {
    stringTable: ['', 'allocations', 'count', 'space', 'bytes', 'run'],
    sampleType: [
      {type: Long.fromInt(1), unit: Long.fromInt(2)},
      {type: Long.fromInt(3), unit: Long.fromInt(4)},
    ],
    defaultSampleType: Long.fromInt(1),
    function: [{id: 1, name: 5}],
    location: [{id: 1, line: [{functionId: 1}]}],
    sample: [{locationId: [1], value: [7, 900]}],
  }
  expect(decode(input).getTotalWeight()).toBe(7)
  expect(decode(input).getWeightUnit()).toBe('none')
  expect(decode({...input, defaultSampleType: Long.ZERO}).getTotalWeight()).toBe(900)
  expect(decode({...input, defaultSampleType: Long.fromInt(999)}).getTotalWeight()).toBe(900)
})

test('locations of one function retain independent source lines and definition-line fallback', () => {
  const profile = decode({
    stringTable: ['', 'samples', 'count', 'run', 'app.go'],
    sampleType: [{type: 1, unit: 2}],
    function: [{id: 1, name: 3, filename: 4, startLine: 1}],
    location: [
      {id: 1, line: [{functionId: 1, line: 10}]},
      {id: 2, line: [{functionId: 1, line: 20}]},
      {id: 3, line: [{functionId: 1}]},
    ],
    sample: [
      {locationId: [1], value: [2]},
      {locationId: [2], value: [3]},
      {locationId: [3], value: [4]},
    ],
  })
  expect([...profile.getFrames()].map(f => [f.name, f.file, f.line, f.getTotalWeight()])).toEqual([
    ['run', 'app.go', 10, 2],
    ['run', 'app.go', 20, 3],
    ['run', 'app.go', 1, 4],
  ])
})

test('uint64 function and location IDs with identical low words stay distinct', () => {
  const high = Long.fromString('18446744069414584321', true)
  const profile = decode({
    stringTable: ['', 'samples', 'count', 'first', 'second'],
    sampleType: [{type: 1, unit: 2}],
    function: [
      {id: 1, name: 3},
      {id: high, name: 4},
    ],
    location: [
      {id: 1, line: [{functionId: 1}]},
      {id: high, line: [{functionId: high}]},
    ],
    sample: [
      {locationId: [1], value: [2]},
      {locationId: [high], value: [3]},
    ],
  })
  expect([...profile.getFrames()].map(f => [f.name, f.getTotalWeight()])).toEqual([
    ['first', 2],
    ['second', 3],
  ])
})
