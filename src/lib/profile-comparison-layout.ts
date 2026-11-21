export interface ComparisonLayoutNode<N> {
  envelope: number
  children: N[]
}
export interface ComparisonGraphTile<N> {
  node: N
  depth: number
  left: number
  width: number
}
export const COMPARISON_GRAPH_LIMITS = Object.freeze({
  maxTiles: 5000,
  maxVisited: 20000,
  maxDepth: 128,
  minWidthPixels: 1,
})

// Unit-width geometry uses the prepared union envelope, never signed deltas.
// No second all-node index is built. Traversal retains O(depth) pending work,
// capped by maxDepth, and at most maxTiles output records.
export function layoutComparisonGraph<N extends ComparisonLayoutNode<N>>(
  root: N,
  viewportWidth: number,
  limits: Partial<typeof COMPARISON_GRAPH_LIMITS> = {},
) {
  const settings = {...COMPARISON_GRAPH_LIMITS, ...limits}
  for (const value of Object.values(settings))
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid comparison graph limits')
  const tiles: ComparisonGraphTile<N>[] = []
  let visited = 0,
    hiddenSmall = 0,
    depthLimited = false,
    budgetLimited = false,
    maxDepth = 0
  if (!Number.isFinite(root.envelope) || root.envelope <= 0 || viewportWidth <= 0)
    return {tiles, visited, hiddenSmall, depthLimited, budgetLimited, rows: 0}
  tiles.push({node: root, depth: 0, left: 0, width: 1})
  visited++
  const pending = [{node: root, depth: 0, left: 0, width: 1, nextLeft: 0, index: 0}]
  while (pending.length) {
    const parent = pending[pending.length - 1]
    if (parent.index === parent.node.children.length) {
      pending.pop()
      continue
    }
    if (visited >= settings.maxVisited || tiles.length >= settings.maxTiles) {
      budgetLimited = true
      break
    }
    const child = parent.node.children[parent.index++]
    visited++
    const ratio = child.envelope / parent.node.envelope
    const left = parent.nextLeft
    const width = Math.max(0, Math.min(parent.width * ratio, parent.left + parent.width - left))
    parent.nextLeft += width
    if (width * viewportWidth < settings.minWidthPixels) {
      hiddenSmall++
      continue
    }
    if (parent.depth + 1 >= settings.maxDepth) {
      depthLimited = true
      continue
    }
    const depth = parent.depth + 1
    maxDepth = Math.max(maxDepth, depth)
    tiles.push({node: child, depth, left, width})
    if (child.children.length)
      pending.push({node: child, depth, left, width, nextLeft: left, index: 0})
  }
  return {tiles, visited, hiddenSmall, depthLimited, budgetLimited, rows: maxDepth + 1}
}

export function visibleComparisonTiles<N>(
  tiles: ComparisonGraphTile<N>[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 1)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight) + 1
  return tiles.filter(tile => tile.depth >= first && tile.depth <= last)
}
