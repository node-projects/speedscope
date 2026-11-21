import fs from 'fs'
import {importFromOTELProfiles, isOTELProfiles} from './otel-profiles'
import {checkProfileSnapshot} from '../lib/test-utils'
import {importProfileGroupFromText} from './index'

function fixture(): any {
  return JSON.parse(fs.readFileSync('sample/profiles/otel-profiles/synthetic.json', 'utf8'))
}
function profile(input: any): any {
  return input.resourceProfiles[0].scopeProfiles[0].profiles[0]
}

test('detects current OTLP Profiles JSON and round-trips aggregate stacks', async () => {
  await checkProfileSnapshot('./sample/profiles/otel-profiles/synthetic.json')
  const group = await importFromOTELProfiles(fixture(), 'example.json')
  expect(group.profiles).toHaveLength(1)
  const imported = group.profiles[0]
  expect(imported.getTotalWeight()).toBe(14)
  expect(imported.getWeightUnit()).toBe('nanoseconds')
  expect(imported.isChronological()).toBe(false)
  expect(imported.getName()).toContain('9007199254740993')
  const main = imported.getGroupedCalltreeRoot().children[0]
  expect(main.frame.name).toBe('main')
  expect(main.children[0].frame).toMatchObject({name: 'inline', file: 'app.js', line: 8, col: 3})
  expect(isOTELProfiles({resourceSpans: []})).toBe(false)
})

const unitCases = [
  ['bytes', 'bytes'],
  ['By', 'bytes'],
  ['µs', 'microseconds'],
  ['us', 'microseconds'],
  ['ms', 'milliseconds'],
  ['s', 'seconds'],
  ['count', 'none'],
  ['1', 'none'],
]
for (const [unit, expected] of unitCases) {
  test(`maps ${unit} to ${expected} without rescaling weights`, async () => {
    const input = fixture()
    input.dictionary.stringTable[2] = unit
    const imported = (await importFromOTELProfiles(input, 'units')).profiles[0]
    expect(imported.getWeightUnit()).toBe(expected)
    expect(imported.getTotalWeight()).toBe(14)
  })
}

test('separates profile objects and sample thread overrides', async () => {
  const input = fixture()
  input.dictionary.attributeTable.push({keyStrindex: 6, value: {intValue: '4'}})
  profile(input).samples[2].attributeIndices = [3]
  input.resourceProfiles[0].scopeProfiles[0].profiles.push({
    ...profile(input),
    profileId: '0123456789abcdef0123456789abcdef',
  })
  const group = await importFromOTELProfiles(input, 'threads')
  expect(group.profiles.map(p => p.getTotalWeight())).toEqual([7, 7, 7, 7])
  expect(new Set(group.profiles.map(p => p.getName())).size).toBe(4)
})

test('preserves uint64 native addresses and reverses leaf-first locations', async () => {
  const input = fixture()
  input.dictionary.locationTable.push({address: '18446744073709551615'})
  input.dictionary.stackTable[1].locationIndices = [2, 1]
  const imported = (await importFromOTELProfiles(input, 'native')).profiles[0]
  const main = imported.getGroupedCalltreeRoot().children[0]
  expect(main.children[0].children[0].frame.name).toContain('0xffffffffffffffff')
})

const invalidCases: [string, (value: any) => void, string][] = [
  [
    'development version',
    (v: any) => {
      v.developmentVersion = 2
    },
    'developmentVersion',
  ],
  [
    'legacy dictionary',
    (v: any) => {
      delete v.dictionary
    },
    'shared dictionary',
  ],
  [
    'legacy samples',
    (v: any) => {
      profile(v).sample = []
    },
    'legacy',
  ],
  [
    'missing sentinel',
    (v: any) => {
      v.dictionary.mappingTable = []
    },
    'zero value',
  ],
  [
    'invalid sentinel',
    (v: any) => {
      v.dictionary.stringTable[0] = 'not empty'
    },
    'zero value',
  ],
  [
    'bad stack reference',
    (v: any) => {
      profile(v).samples[0].stackIndex = 88
    },
    'stackTable',
  ],
  [
    'bad function reference',
    (v: any) => {
      v.dictionary.locationTable[1].lines[0].functionIndex = 99
    },
    'functionTable',
  ],
  [
    'unsafe epoch number',
    (v: any) => {
      profile(v).timeUnixNano = 1795262400000000000
    },
    'safe integer',
  ],
  [
    'uint64 overflow',
    (v: any) => {
      profile(v).timeUnixNano = '18446744073709551616'
    },
    'out of range',
  ],
  [
    'range overflow',
    (v: any) => {
      profile(v).timeUnixNano = '18446744073709551615'
    },
    'overflows',
  ],
  [
    'negative weight',
    (v: any) => {
      profile(v).samples[0].values = ['-1', '2']
    },
    'nonnegative',
  ],
  [
    'unsafe weight',
    (v: any) => {
      profile(v).samples[0].values = ['9007199254740992', '2']
    },
    'safe integer',
  ],
  [
    'profile total',
    (v: any) => {
      profile(v).samples[0].values = ['9007199254740991', '0']
    },
    'profile total',
  ],
  [
    'mismatched observations',
    (v: any) => {
      profile(v).samples[0].values = ['1']
    },
    'length mismatch',
  ],
  [
    'empty sample',
    (v: any) => {
      profile(v).samples[0] = {}
    },
    'requires values',
  ],
  [
    'out-of-range timestamp',
    (v: any) => {
      profile(v).samples[0].timestampsUnixNano[0] = '1795262400000000100'
    },
    'outside profile range',
  ],
  [
    'unknown unit',
    (v: any) => {
      v.dictionary.stringTable[2] = 'fortnights'
    },
    'unsupported sample unit',
  ],
  [
    'duplicate attribute keys',
    (v: any) => {
      profile(v).attributeIndices = [1, 1]
    },
    'duplicate attribute',
  ],
]
for (const [label, mutate, message] of invalidCases) {
  test(`rejects ${label} clearly`, async () => {
    const input = fixture()
    mutate(input)
    await expect(importFromOTELProfiles(input, 'invalid')).rejects.toThrow(message)
  })
}

test('accepts advertised development version 1 and omitted optional empty fields', async () => {
  const input = fixture()
  input.developmentVersion = 1
  delete profile(input).periodType
  delete profile(input).period
  delete profile(input).attributeIndices
  expect((await importFromOTELProfiles(input, 'defaults')).profiles).toHaveLength(1)
})

test('aborts before importing and yields while processing large observation arrays', async () => {
  const input = fixture()
  const controller = new AbortController()
  controller.abort()
  await expect(
    importFromOTELProfiles(input, 'cancelled', {signal: controller.signal}),
  ).rejects.toMatchObject({name: 'AbortError'})
  const active = new AbortController()
  profile(input).samples = [{stackIndex: 1, values: new Array(20000).fill('1')}]
  setTimeout(() => active.abort(), 0)
  await expect(
    importFromOTELProfiles(input, 'cancelled', {signal: active.signal}),
  ).rejects.toMatchObject({
    name: 'AbortError',
  })
})

for (const unit of ['constructor', 'toString', '__proto__']) {
  test(`rejects inherited property unit ${unit}`, async () => {
    const input = fixture()
    input.dictionary.stringTable[2] = unit
    await expect(importFromOTELProfiles(input, 'invalid')).rejects.toThrow(
      'unsupported sample unit',
    )
  })
}

test('enforces input dictionary, stack and attribute bounds before expansion', async () => {
  const input = fixture()
  input.dictionary.stringTable = new Array(1_000_001).fill('')
  await expect(importFromOTELProfiles(input, 'invalid')).rejects.toThrow('1,000,000 entries')
  const deep = fixture()
  deep.dictionary.stackTable[1].locationIndices = new Array(100_001).fill(1)
  await expect(importFromOTELProfiles(deep, 'deep')).rejects.toThrow('100,000 frames')
  const attrs = fixture()
  profile(attrs).attributeIndices = new Array(4097).fill(1)
  await expect(importFromOTELProfiles(attrs, 'attrs')).rejects.toThrow('4096 entries')
})

test('native schema takes priority over an incidental resourceProfiles field', async () => {
  const group = await importProfileGroupFromText(
    'renamed.json',
    JSON.stringify({
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      name: 'native',
      shared: {frames: []},
      profiles: [],
      resourceProfiles: [],
    }),
  )
  expect(group!.profiles).toEqual([])
})

test('rejects complex thread identities instead of merging distinct threads', async () => {
  const input = fixture()
  input.dictionary.attributeTable[1].value = {arrayValue: {values: [{intValue: '1'}]}}
  await expect(importFromOTELProfiles(input, 'invalid')).rejects.toThrow(
    'unsupported identity attribute',
  )
})

for (const field of ['values', 'timestampsUnixNano', 'attributeIndices']) {
  test(`rejects null elements in sample ${field}`, async () => {
    const input = fixture()
    profile(input).samples[0][field] = [null]
    await expect(importFromOTELProfiles(input, 'invalid')).rejects.toThrow('null entry')
  })
}

test('uses function start line when a location has no line information', async () => {
  const input = fixture()
  input.dictionary.locationTable[1].lines[1].line = '0'
  input.dictionary.functionTable[1].startLine = '12'
  const group = await importFromOTELProfiles(input, 'lines')
  expect(group.profiles[0].getGroupedCalltreeRoot().children[0].frame.line).toBe(12)
})

test('rejects malformed optional arrays instead of treating false or zero as absent', async () => {
  const samples = fixture()
  profile(samples).samples = false
  await expect(importFromOTELProfiles(samples, 'invalid')).rejects.toThrow('invalid samples')
  const values = fixture()
  profile(values).samples[0].values = 0
  await expect(importFromOTELProfiles(values, 'invalid')).rejects.toThrow('invalid sample values')
  const sentinel = fixture()
  sentinel.dictionary.mappingTable[0] = 0
  await expect(importFromOTELProfiles(sentinel, 'invalid')).rejects.toThrow('zero value')
})
