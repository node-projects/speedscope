import {getVisibleCallTreeRows} from './call-tree-view'
import {StackListProfileBuilder} from '../lib/profile'

test('call-tree traversal prunes collapsed nodes and bounds visible rows', () => {
  const builder = new StackListProfileBuilder()
  const frame = (key: string) => ({key, name: key})
  for (let i = 0; i < 300; i++) builder.appendSampleWithWeight([frame(`${i}`), frame('child')], 1)
  const profile = builder.build()
  const roots = profile.getGroupedCalltreeRoot().children
  const collapsed = getVisibleCallTreeRows(profile, new Set(), 200)
  expect(collapsed.length).toBe(201)
  expect(collapsed.every(row => row.depth === 0)).toBe(true)
  const expanded = getVisibleCallTreeRows(profile, new Set([roots[0]]), 200)
  expect(expanded[1].node.frame.name).toBe('child')
  expect(expanded[1].depth).toBe(1)
})
