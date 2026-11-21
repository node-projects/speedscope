import {layoutComparisonGraph, visibleComparisonTiles} from './profile-comparison-layout'

interface Node {
  envelope: number
  children: Node[]
}
const node = (envelope: number, children: Node[] = []): Node => ({envelope, children})

test('union-envelope child widths stay inside parents and preserve self gaps', () => {
  const child = node(5, [node(2), node(1)])
  const root = node(10, [child, node(3)])
  const layout = layoutComparisonGraph(root, 1000)
  expect(layout.tiles.map(tile => [tile.depth, tile.left, tile.width])).toEqual([
    [0, 0, 1],
    [1, 0, 0.5],
    [2, 0, 0.2],
    [2, 0.2, 0.1],
    [1, 0.5, 0.3],
  ])
  expect(layout.rows).toBe(3)
  expect(layout.budgetLimited).toBe(false)
})

test('deep hierarchies use bounded iterative traversal and expose drill-down truncation', () => {
  const root = node(1)
  let parent = root
  for (let i = 0; i < 30000; i++) {
    const child = node(1)
    parent.children.push(child)
    parent = child
  }
  const layout = layoutComparisonGraph(root, 1000)
  expect(layout.tiles).toHaveLength(128)
  expect(layout.depthLimited).toBe(true)
  expect(layout.visited).toBe(129)
})

test('wide layouts cap visits and tiles without scheduling all siblings', () => {
  let reads = 0
  const children = Array.from({length: 30000}, () => node(1))
  Object.defineProperty(children, 20000, {
    get: () => {
      reads++
      throw new Error('Past visit budget')
    },
  })
  const layout = layoutComparisonGraph(node(30000, children), 1000)
  expect(layout.visited).toBe(20000)
  expect(layout.tiles).toHaveLength(1)
  expect(layout.budgetLimited).toBe(true)
  expect(reads).toBe(0)
  const visible = layoutComparisonGraph(node(10000, children.slice(0, 10000)), 20000)
  expect(visible.tiles).toHaveLength(5000)
  expect(visible.budgetLimited).toBe(true)
})

test('viewport filtering bounds mounted rows and keeps a small overscan', () => {
  const tiles = Array.from({length: 128}, (_, depth) => ({node: node(1), depth, left: 0, width: 1}))
  const visible = visibleComparisonTiles(tiles, 240, 240, 24)
  expect(visible[0].depth).toBe(9)
  expect(visible[visible.length - 1].depth).toBe(21)
  expect(visible).toHaveLength(13)
})

test('empty comparison weights avoid invalid geometry', () => {
  expect(layoutComparisonGraph(node(0), 1000).tiles).toEqual([])
  expect(layoutComparisonGraph(node(1), 0).tiles).toEqual([])
})
