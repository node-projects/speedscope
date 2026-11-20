import {CallTreeNode} from './profile'

export const STACK_PAGE_SIZE = 100

// Follow only the displayed part of the existing parent chain. Do not build a
// complete ancestor array, count the entire stack or retain page history.
export function stackPage(start: CallTreeNode) {
  const nodes: CallTreeNode[] = []
  let next: CallTreeNode | null = start
  while (next && !next.isRoot() && nodes.length < STACK_PAGE_SIZE) {
    nodes.push(next)
    next = next.parent
  }
  return {nodes, next: next && !next.isRoot() ? next : null}
}
