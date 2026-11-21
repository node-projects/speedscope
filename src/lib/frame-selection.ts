import {CallTreeNode, Frame} from './profile'

export function nodeBelongsToTree(node: CallTreeNode, root: CallTreeNode): boolean {
  let top = node
  while (top.parent) top = top.parent
  return top === root
}

// Stop at the first occurrence. No per-frame occurrence index or array of all
// nodes is retained; traversal uses O(depth) auxiliary storage.
export function findFrameNode(root: CallTreeNode, frame: Frame): CallTreeNode | null {
  const pending = [{nodes: root.children, index: 0}]
  while (pending.length) {
    const current = pending[pending.length - 1]
    if (current.index === current.nodes.length) {
      pending.pop()
      continue
    }
    const node = current.nodes[current.index++]
    if (node.frame === frame) return node
    if (node.children.length) pending.push({nodes: node.children, index: 0})
  }
  return null
}
