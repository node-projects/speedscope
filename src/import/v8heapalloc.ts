import {Profile, FrameInfo, CallTreeProfileBuilder} from '../lib/profile'
import {ByteFormatter} from '../lib/value-formatters'

/**
 * The V8 Heap Allocation profile is a way to represent heap allocation for each
 * javascript function. The format is a simple tree where the weight of each node
 * represent the memory allocated by the function and all its callee.
 * You can find more information on how to get a profile there :
 * https://developers.google.com/web/tools/chrome-devtools/memory-problems/#allocation-profile
 * You need to scroll down to "Investigate memory allocation by function"
 *
 * Note that Node.JS can retrieve this kind of profile via the Inspector protocol.
 */

interface HeapProfileCallFrame {
  columnNumber: number
  functionName: string
  lineNumber: number
  scriptId: string
  url: string
}

interface HeapProfileNode {
  callFrame: HeapProfileCallFrame
  selfSize: number
  children: HeapProfileNode[]
}

interface HeapProfile {
  head: HeapProfileNode
}

function frameInfoForCallFrame(callFrame: HeapProfileCallFrame): FrameInfo {
  const file = callFrame.url
  const line = callFrame.lineNumber
  const col = callFrame.columnNumber
  const name =
    callFrame.functionName ||
    (file ? `(anonymous ${file.split('/').pop()}:${line})` : '(anonymous)')
  return {
    key: `${name}:${file}:${line}:${col}`,
    name,
    file,
    line,
    col,
  }
}

export function importFromChromeHeapProfile(chromeProfile: HeapProfile): Profile {
  const profile = new CallTreeProfileBuilder()
  profile.setChronological(false)
  let value = 0
  // A preorder walk preserves the previous weighted stack order, without
  // recursive passes, a parent/id map, or a materialized path for every node.
  interface PendingNode {
    node: HeapProfileNode
    frame: FrameInfo | null
    index: number
  }
  const stack: PendingNode[] = []
  let openedDepth = 0
  const enter = (node: HeapProfileNode) => {
    stack.push({node, frame: null, index: 0})
    const weight = node.selfSize ?? 0
    if (!Number.isFinite(weight) || weight < 0)
      throw new Error('Heap allocation sizes must be finite and non-negative')
    // Delay opening zero-sized ancestors until a positive descendant needs
    // them. Entire empty branches then add no frames/nodes, as before.
    if (weight > 0) {
      while (openedDepth < stack.length) {
        const pending = stack[openedDepth++]
        pending.frame = frameInfoForCallFrame(pending.node.callFrame)
        profile.enterFrame(pending.frame, value)
      }
    }
    value += weight
    if (!Number.isFinite(value)) throw new Error('Heap allocation total must be finite')
  }
  enter(chromeProfile.head)
  while (stack.length) {
    const current = stack[stack.length - 1]
    if (current.index < current.node.children.length) {
      enter(current.node.children[current.index++])
    } else {
      if (current.frame) {
        profile.leaveFrame(current.frame, value)
        openedDepth--
      }
      stack.pop()
    }
  }
  profile.setValueFormatter(new ByteFormatter())
  return profile.build()
}
