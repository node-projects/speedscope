import {findFrameNode, nodeBelongsToTree} from './frame-selection'
import {CallTreeNode, Frame} from './profile'

test('first-occurrence selection stops before later branches', () => {
  const root = new CallTreeNode(Frame.root, null),
    frame = {name: 'target'} as Frame
  const selected = new CallTreeNode(frame, root)
  const later = new CallTreeNode({name: 'other'} as Frame, root)
  Object.defineProperty(later, 'frame', {
    get: () => {
      throw Error('Unnecessary scan')
    },
  })
  root.children.push(selected, later)
  expect(findFrameNode(root, frame)).toBe(selected)
  expect(nodeBelongsToTree(selected, root)).toBe(true)
  expect(nodeBelongsToTree(selected, new CallTreeNode(Frame.root, null))).toBe(false)
})
test('selection resolves deep trees iteratively and handles absent frames', () => {
  const root = new CallTreeNode(Frame.root, null),
    frame = {name: 'target'} as Frame,
    other = {name: 'other'} as Frame
  let parent = root
  for (let i = 0; i < 30000; i++) {
    const node = new CallTreeNode(other, parent)
    parent.children.push(node)
    parent = node
  }
  const target = new CallTreeNode(frame, parent)
  parent.children.push(target)
  expect(findFrameNode(root, frame)).toBe(target)
  expect(nodeBelongsToTree(target, root)).toBe(true)
  expect(findFrameNode(root, {name: 'missing'} as Frame)).toBe(null)
})
