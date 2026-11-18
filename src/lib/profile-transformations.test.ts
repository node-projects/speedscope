import {CallTreeProfileBuilder} from './profile'
import {
  combineProfiles,
  cropProfile,
  groupProfileByFile,
  invertProfile,
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

test('file grouping preserves total weight and file-level self time (#339)', () => {
  const grouped = groupProfileByFile(profile())
  const root = grouped.getGroupedCalltreeRoot().children[0]
  expect(grouped.getTotalWeight()).toBe(10)
  expect(root.frame.name).toBe('a.ts')
  expect(root.getSelfWeight()).toBe(6)
  expect(root.children[0].frame.name).toBe('b.ts')
})
