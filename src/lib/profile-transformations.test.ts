import {CallTreeProfileBuilder, StackListProfileBuilder} from './profile'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {
  combineProfiles,
  cropProfile,
  groupProfileByFile,
  invertProfile,
  filterProfile,
} from './profile-transformations'

function profile(name = 'test', file = 'a.ts') {
  const builder = new CallTreeProfileBuilder(12)
  builder.setName(name)
  const outer = {key: 0, name: 'outer', file}
  const inner = {key: 1, name: 'inner', file: 'b.ts'}
  builder.enterFrame(outer, 0)
  builder.enterFrame(inner, 3)
  builder.leaveFrame(inner, 7)
  builder.leaveFrame(outer, 10)
  return builder.build()
}

test('cropping clips crossing boundaries and preserves idle range (#39)', () => {
  const original = profile()
  const cropped = cropProfile(original, 2, 8)
  const outer = cropped.getGroupedCalltreeRoot().children[0]
  expect(cropped.getTotalWeight()).toBe(6)
  expect(outer.getTotalWeight()).toBe(6)
  expect(outer.children[0].getTotalWeight()).toBe(4)
  expect(cropProfile(original, 8, 12).getTotalWeight()).toBe(4)
  expect(original.getTotalWeight()).toBe(12)
})

test('combined profiles sum busy weights, use source identity and avoid derived double counting (#513)', () => {
  const a = profile('one'),
    b = profile('two', 'different.ts')
  const combined = combineProfiles([a, b])
  expect(combined.getTotalWeight()).toBe(20)
  expect(combined.getGroupedCalltreeRoot().children).toHaveLength(2)
  expect(combineProfiles([a, b, combined]).getTotalWeight()).toBe(20)
})

test('inversion reverses complete stacks without losing self time (#497)', () => {
  const inverted = invertProfile(profile())
  expect(inverted.getTotalWeight()).toBe(10)
  const inner = inverted
    .getGroupedCalltreeRoot()
    .children.find(node => node.frame.name === 'inner')!
  expect(inner.children[0].frame.name).toBe('outer')
  expect(inner.getTotalWeight()).toBe(4)
})

test('aggregate and derived metadata survive cloning and export without double counting', () => {
  const originals = [profile('one'), profile('two')]
  const combined = combineProfiles(originals)
  const exported = exportProfileGroup({
    name: 'group',
    indexToView: 2,
    profiles: [...originals, combined],
  })
  const imported = importSpeedscopeProfiles(exported)
  expect(imported.profiles[2].isChronological()).toBe(false)
  expect(imported.profiles[2].shallowClone().isDerived()).toBe(true)
  expect(combineProfiles(imported.profiles).getTotalWeight()).toBe(20)
  expect(cropProfile(originals[0], 0, 2).isChronological()).toBe(true)
  expect(groupProfileByFile(originals[0]).isChronological()).toBe(false)
})

test('file grouping preserves total weight and file-level self time (#339)', () => {
  const grouped = groupProfileByFile(profile())
  const root = grouped.getGroupedCalltreeRoot().children[0]
  expect(grouped.getTotalWeight()).toBe(10)
  expect(root.frame.name).toBe('a.ts')
  expect(root.getSelfWeight()).toBe(6)
  expect(root.children[0].frame.name).toBe('b.ts')
})

test('frame filters retain remaining stack weights and reattribute hidden leaf self weight', async () => {
  const original = profile()
  const before = exportProfileGroup({name: 'group', indexToView: 0, profiles: [original]})
  const outerOnly = await filterProfile(original, {field: 'file', include: ['A.TS'], exclude: []})
  expect(outerOnly.getTotalWeight()).toBe(10) // 2 idle units omitted
  const outer = outerOnly.getGroupedCalltreeRoot().children[0]
  expect(outer.frame.name).toBe('outer')
  expect(outer.getSelfWeight()).toBe(10) // includes the 4 hidden inner units
  expect(outer.children).toHaveLength(0)
  const innerOnly = await filterProfile(original, {field: 'name', include: [], exclude: ['outer']})
  expect(innerOnly.getTotalWeight()).toBe(4) // outer-only stacks omitted
  expect(innerOnly.getGroupedCalltreeRoot().children[0].frame.name).toBe('inner')
  expect(innerOnly.isChronological()).toBe(false)
  expect(innerOnly.isDerived()).toBe(true)
  expect(exportProfileGroup({name: 'group', indexToView: 0, profiles: [original]})).toEqual(before)
})

test('include rules are ORed; excludes win, file separators normalize, and unknown paths do not match', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [
      {key: 0, name: 'app', file: 'C:\\src\\app.ts'},
      {key: '0', name: 'hidden', file: 'C:\\src\\vendor\\lib.ts'},
      {key: 2, name: 'unmapped'},
    ],
    3,
  )
  const original = builder.build()
  const filtered = await filterProfile(original, {
    field: 'file',
    include: ['missing/', 'C:/SRC/'],
    exclude: ['vendor/'],
  })
  expect(filtered.getTotalWeight()).toBe(3)
  expect(filtered.getGroupedCalltreeRoot().children[0].frame.name).toBe('app')
  expect(filtered.getGroupedCalltreeRoot().children[0].children).toHaveLength(0)
  const none = await filterProfile(original, {
    field: 'either',
    include: ['unmapped'],
    exclude: ['unmapped'],
  })
  expect(none.getTotalWeight()).toBe(0)
})

test('filter descriptions, source identity, units and derived flags survive export/reimport', async () => {
  const original = profile()
  const derived = await filterProfile(original, {
    field: 'either',
    include: ['outer', 'b.ts'],
    exclude: [],
  })
  const imported = importSpeedscopeProfiles(
    exportProfileGroup({name: 'group', indexToView: 1, profiles: [original, derived]}),
  )
  expect(imported.profiles[1].getName()).toContain('filter either: include ["outer","b.ts"]')
  expect(imported.profiles[1].isDerived()).toBe(true)
  expect(imported.profiles[1].isChronological()).toBe(false)
  expect(imported.profiles[1].getWeightUnit()).toBe(original.getWeightUnit())
  expect(combineProfiles(imported.profiles).getTotalWeight()).toBe(10)
})

test('filters preserve distinct source identities for equal names and numeric/string keys', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 0, name: 'same', file: 'a.ts', line: 2, col: 3}], 2)
  builder.appendSampleWithWeight([{key: '0', name: 'same', file: 'b.ts', line: 4, col: 5}], 3)
  const result = await filterProfile(builder.build(), {
    field: 'name',
    include: ['same'],
    exclude: [],
  })
  const nodes = result.getGroupedCalltreeRoot().children
  expect(nodes).toHaveLength(2)
  expect(
    nodes.map(n => [n.frame.key, n.frame.file, n.frame.line, n.frame.col, n.getTotalWeight()]),
  ).toEqual(
    expect.arrayContaining([
      [0, 'a.ts', 2, 3, 2],
      ['0', 'b.ts', 4, 5, 3],
    ]),
  )
})

test('deep grouped filtering yields, supports cancellation, and avoids recursive traversal', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    Array.from({length: 20000}, (_, i) => ({
      key: i,
      name: `f${i}`,
      file: i % 2 ? 'vendor.ts' : 'app.ts',
    })),
    1,
  )
  const original = builder.build()
  let yields = 0
  const filtered = await filterProfile(
    original,
    {field: 'file', include: ['app.ts'], exclude: []},
    {
      yieldControl: async () => {
        yields++
      },
    },
  )
  expect(yields).toBeGreaterThan(2)
  let calls = 0
  filtered.forEachCall(
    () => calls++,
    () => {},
  )
  expect(calls).toBe(10000)
  const controller = new AbortController()
  let pauses = 0
  await expect(
    filterProfile(
      original,
      {field: 'file', include: ['app.ts'], exclude: []},
      {
        signal: controller.signal,
        yieldControl: async () => {
          if (++pauses === 2) controller.abort()
        },
      },
    ),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(original.getTotalWeight()).toBe(1)
})
