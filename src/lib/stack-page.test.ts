import {CallTreeNode, Frame} from './profile'
import {stackPage, STACK_PAGE_SIZE} from './stack-page'

test('ancestor pages bound traversal and allocation independently of stack depth', () => {
  const root = new CallTreeNode(Frame.root, null)
  let deepest = new CallTreeNode({name: 'scope'} as Frame, root)
  for (let i = 1; i < 100_000; i++) deepest = new CallTreeNode(deepest.frame, deepest)
  // Any attempt to count/traverse the full chain on the first page must fail.
  let boundary = deepest
  for (let i = 0; i < STACK_PAGE_SIZE; i++) boundary = boundary.parent!
  const parent = boundary.parent
  Object.defineProperty(boundary, 'parent', {
    configurable: true,
    get: () => {
      throw new Error('Traversal exceeded page')
    },
  })
  const page = stackPage(deepest)
  expect(page.nodes.length).toBe(STACK_PAGE_SIZE)
  expect(page.next).toBe(boundary)
  Object.defineProperty(boundary, 'parent', {value: parent})
})

test('every ancestor is reachable once without retaining root or page history', () => {
  const root = new CallTreeNode(Frame.root, null)
  const expected: CallTreeNode[] = []
  let node = root
  for (let i = 0; i < 205; i++) {
    node = new CallTreeNode({name: `scope-${i}`} as Frame, node)
    expected.unshift(node)
  }
  const seen: CallTreeNode[] = []
  let cursor: CallTreeNode | null = node
  const sizes: number[] = []
  while (cursor) {
    const page = stackPage(cursor)
    sizes.push(page.nodes.length)
    seen.push(...page.nodes)
    cursor = page.next
  }
  expect(sizes).toEqual([100, 100, 5])
  expect(seen).toEqual(expected)
  expect(stackPage(root)).toEqual({nodes: [], next: null})
})
