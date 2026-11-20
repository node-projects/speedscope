import {lastOf, KeyedSet, visitTree} from './utils'
import {ValueFormatter, RawValueFormatter, TimeFormatter, ByteFormatter} from './value-formatters'
import {FileFormat} from './file-format-spec'
import {ProfileSnapshot, HydrationOptions} from './profile-snapshot'

export interface FrameInfo {
  key: string | number

  // Name of the frame. May be a method name, e.g.
  // "ActiveRecord##to_hash"
  name: string

  // File path of the code corresponding to this
  // call stack frame.
  file?: string

  // Line in the given file where this frame occurs, 1-based.
  line?: number

  // Column in the file, 1-based.
  col?: number
}

export type SymbolRemapper = (
  frame: Frame,
) => {name?: string; file?: string; line?: number; col?: number} | null

export class HasWeights {
  private selfWeight = 0
  private totalWeight = 0
  getSelfWeight() {
    return this.selfWeight
  }
  getTotalWeight() {
    return this.totalWeight
  }
  addToTotalWeight(delta: number) {
    this.totalWeight += delta
  }
  addToSelfWeight(delta: number) {
    this.selfWeight += delta
  }

  overwriteWeightWith(other: HasWeights) {
    this.selfWeight = other.selfWeight
    this.totalWeight = other.totalWeight
  }
}

export class Frame extends HasWeights {
  key: string | number

  // Name of the frame. May be a method name, e.g.
  // "ActiveRecord##to_hash"
  name: string

  // File path of the code corresponding to this
  // call stack frame.
  file?: string

  // Line in the given file where this frame occurs
  line?: number

  // Column in the file
  col?: number

  private constructor(info: FrameInfo) {
    super()
    this.key = info.key
    this.name = info.name
    this.file = info.file
    this.line = info.line
    this.col = info.col
  }

  static root = new Frame({
    key: '(speedscope root)',
    name: '(speedscope root)',
  })

  static getOrInsert(set: KeyedSet<Frame>, info: FrameInfo) {
    return set.get(info.key) || set.getOrInsert(new Frame(info))
  }
}

export class CallTreeNode extends HasWeights {
  children: CallTreeNode[] = []

  isRoot() {
    return this.frame === Frame.root
  }

  // If a node is "frozen", it means it should no longer be mutated.
  private frozen = false
  isFrozen() {
    return this.frozen
  }
  freeze() {
    this.frozen = true
  }

  constructor(
    readonly frame: Frame,
    readonly parent: CallTreeNode | null,
  ) {
    super()
  }
}

export interface ProfileGroup {
  name: string
  // Runtime provenance for the currently opened file; not interchange metadata.
  sourceName?: string
  indexToView: number
  profiles: Profile[]
}

export interface CallTreeEvent {
  node: CallTreeNode
  value: number
  open: boolean
}

// Most nodes have few children. Allocate lookup maps only for wide nodes and
// release them when construction finishes; completed profiles keep just trees.
class GroupedCallTreeIndex {
  private indexes = new WeakMap<CallTreeNode, Map<Frame, CallTreeNode>>()

  getOrCreate(parent: CallTreeNode, frame: Frame): CallTreeNode {
    let index = this.indexes.get(parent)
    if (!index && parent.children.length >= 16) {
      index = new Map(parent.children.map(child => [child.frame, child]))
      this.indexes.set(parent, index)
    }
    let node = index ? index.get(frame) : parent.children.find(child => child.frame === frame)
    if (!node) {
      node = new CallTreeNode(frame, parent)
      parent.children.push(node)
      if (index) index.set(frame, node)
    }
    return node
  }

  clear() {
    this.indexes = new WeakMap()
  }
}

export class Profile {
  protected name: string = ''
  private chronological = true
  private derived = false

  isChronological() {
    return this.chronological
  }
  setChronological(value: boolean) {
    this.chronological = value
  }
  isDerived() {
    return this.derived
  }
  setDerived(value: boolean) {
    this.derived = value
  }

  protected totalWeight: number

  protected frames = new KeyedSet<Frame>()

  // Profiles store two call-trees.
  //
  // The "append order" call tree is the one in which nodes are ordered in
  // whatever order they were appended to their parent.
  //
  // The "grouped" call tree is one in which each node has at most one child per
  // frame. Nodes are ordered in decreasing order of weight
  protected appendOrderCalltreeRoot = new CallTreeNode(Frame.root, null)
  protected groupedCalltreeRoot = new CallTreeNode(Frame.root, null)

  public getAppendOrderCalltreeRoot() {
    return this.appendOrderCalltreeRoot
  }
  public getGroupedCalltreeRoot() {
    return this.groupedCalltreeRoot
  }

  // List of references to CallTreeNodes at the top of the
  // stack at the time of the sample.
  protected samples: CallTreeNode[] = []
  protected weights: number[] = []

  protected valueFormatter: ValueFormatter = new RawValueFormatter()

  constructor(totalWeight: number = 0) {
    this.totalWeight = totalWeight
  }

  toSnapshot(): ProfileSnapshot {
    const frames = [...this.frames]
    const frameIndexes = new Map(frames.map((frame, index) => [frame, index]))
    const sampleIndexes = new Map<CallTreeNode, number>()
    const frameWeights = new Float64Array(frames.length * 2)
    frames.forEach((frame, index) => {
      frameWeights[index * 2] = frame.getTotalWeight()
      frameWeights[index * 2 + 1] = frame.getSelfWeight()
    })
    const encodeTree = (root: CallTreeNode, append: boolean) => {
      let count = 0
      visitTree([root], () => {
        count++
      })
      const data = new Float64Array(count * 4)
      const ancestors: number[] = []
      let index = 0
      visitTree([root], (node, depth) => {
        if (append) sampleIndexes.set(node, index)
        const offset = index * 4
        data[offset] = node.isRoot() ? -1 : frameIndexes.get(node.frame)!
        data[offset + 1] = depth ? ancestors[depth - 1] : -1
        data[offset + 2] = node.getTotalWeight()
        data[offset + 3] = node.getSelfWeight()
        ancestors[depth] = index++
      })
      return data
    }
    const appendNodes = encodeTree(this.appendOrderCalltreeRoot, true)
    const groupedNodes = encodeTree(this.groupedCalltreeRoot, false)
    return {
      name: this.name,
      unit: this.getWeightUnit(),
      totalWeight: this.totalWeight,
      chronological: this.chronological,
      derived: this.derived,
      frames: frames.map(({key, name, file, line, col}) => ({key, name, file, line, col})),
      frameWeights,
      appendNodes,
      groupedNodes,
      samples: Uint32Array.from(this.samples, node => sampleIndexes.get(node)!),
      weights: Float64Array.from(this.weights),
    }
  }

  static async fromSnapshot(
    data: ProfileSnapshot,
    options: HydrationOptions = {},
  ): Promise<Profile> {
    const pause = async () => {
      if (options.signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
      await (options.yieldControl
        ? options.yieldControl()
        : new Promise(resolve => setTimeout(resolve, 0)))
      if (options.signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
    }
    await pause()
    if (
      data.frameWeights.length !== data.frames.length * 2 ||
      data.samples.length !== data.weights.length ||
      !Number.isFinite(data.totalWeight) ||
      data.totalWeight < 0
    )
      throw new Error('Invalid profile snapshot dimensions or total weight')
    const profile = new Profile(data.totalWeight)
    profile.setName(data.name)
    profile.setChronological(data.chronological)
    profile.setDerived(data.derived)
    if (data.unit === 'bytes') profile.setValueFormatter(new ByteFormatter())
    else if (data.unit === 'none') profile.setValueFormatter(new RawValueFormatter())
    else profile.setValueFormatter(new TimeFormatter(data.unit))
    const setWeights = (target: HasWeights, total: number, self: number) => {
      if (!Number.isFinite(total) || !Number.isFinite(self) || total < 0 || self < 0)
        throw new Error('Invalid profile snapshot weights')
      target.addToTotalWeight(total)
      target.addToSelfWeight(self)
    }
    const frames: Frame[] = []
    for (let i = 0; i < data.frames.length; i++) {
      const frame = Frame.getOrInsert(profile.frames, data.frames[i])
      setWeights(frame, data.frameWeights[i * 2], data.frameWeights[i * 2 + 1])
      frames.push(frame)
      if ((i + 1) % 4096 === 0) await pause()
    }
    const decodeTree = async (tree: Float64Array): Promise<CallTreeNode[]> => {
      if (!tree.length || tree.length % 4) throw new Error('Invalid profile snapshot tree')
      const nodes: CallTreeNode[] = []
      for (let i = 0; i < tree.length / 4; i++) {
        const offset = i * 4
        const frame = tree[offset],
          parent = tree[offset + 1]
        const total = tree[offset + 2],
          self = tree[offset + 3]
        if (
          i === 0
            ? frame !== -1 || parent !== -1
            : !Number.isInteger(frame) ||
              frame < 0 ||
              frame >= frames.length ||
              !Number.isInteger(parent) ||
              parent < 0 ||
              parent >= i
        )
          throw new Error('Invalid profile snapshot node reference')
        const node = new CallTreeNode(i ? frames[frame] : Frame.root, i ? nodes[parent] : null)
        setWeights(node, total, self)
        if (node.parent) node.parent.children.push(node)
        nodes.push(node)
        if ((i + 1) % 16384 === 0) await pause()
      }
      return nodes
    }
    const appendNodes = await decodeTree(data.appendNodes)
    profile.appendOrderCalltreeRoot = appendNodes[0]
    profile.groupedCalltreeRoot = (await decodeTree(data.groupedNodes))[0]
    for (let i = 0; i < data.samples.length; i++) {
      if (
        data.samples[i] >= appendNodes.length ||
        !Number.isFinite(data.weights[i]) ||
        data.weights[i] < 0
      )
        throw new Error('Invalid profile snapshot sample')
      profile.samples.push(appendNodes[data.samples[i]])
      profile.weights.push(data.weights[i])
      if ((i + 1) % 16384 === 0) await pause()
    }
    await pause()
    return profile
  }

  shallowClone(): Profile {
    const profile = new Profile(this.totalWeight)
    Object.assign(profile, this)
    return profile
  }

  formatValue(v: number, step?: number) {
    return this.valueFormatter.format(v, step)
  }
  setValueFormatter(f: ValueFormatter) {
    this.valueFormatter = f
  }
  getWeightUnit(): FileFormat.ValueUnit {
    return this.valueFormatter.unit
  }

  getName() {
    return this.name
  }
  setName(name: string) {
    this.name = name
  }

  getTotalWeight() {
    return this.totalWeight
  }

  private totalNonIdleWeight: number | null = null
  getTotalNonIdleWeight() {
    if (this.totalNonIdleWeight === null) {
      this.totalNonIdleWeight = this.groupedCalltreeRoot.children.reduce(
        (n, c) => n + c.getTotalWeight(),
        0,
      )
    }
    return this.totalNonIdleWeight
  }

  // This is private because it should only be called in the ProfileBuilder
  // classes. Once a Profile instance has been constructed, it should be treated
  // as immutable.
  protected sortGroupedCallTree() {
    const pending = [this.groupedCalltreeRoot]
    while (pending.length > 0) {
      const node = pending.pop()!
      node.children.sort((a, b) => -(a.getTotalWeight() - b.getTotalWeight()))
      // Push individually: spreading a very wide node can exceed argument limits.
      for (const child of node.children) pending.push(child)
    }
  }

  forEachCallGrouped(
    openFrame: (node: CallTreeNode, value: number) => void,
    closeFrame: (node: CallTreeNode, value: number) => void,
  ) {
    const stack = [{node: this.groupedCalltreeRoot, start: 0, childTime: 0, index: -1}]
    while (stack.length) {
      const current = stack[stack.length - 1]
      if (current.index === -1) {
        if (!current.node.isRoot()) openFrame(current.node, current.start)
        current.index = 0
      }
      if (current.index < current.node.children.length) {
        const child = current.node.children[current.index++]
        const start = current.start + current.childTime
        current.childTime += child.getTotalWeight()
        stack.push({node: child, start, childTime: 0, index: -1})
      } else {
        if (!current.node.isRoot())
          closeFrame(current.node, current.start + current.node.getTotalWeight())
        stack.pop()
      }
    }
  }

  forEachCall(
    openFrame: (node: CallTreeNode, value: number) => void,
    closeFrame: (node: CallTreeNode, value: number) => void,
  ) {
    for (const {node, value, open} of this.getCallEvents()) {
      if (open) openFrame(node, value)
      else closeFrame(node, value)
    }
  }

  // Lazy iteration lets large consumers pause without materializing all events.
  *getCallEvents(): IterableIterator<CallTreeEvent> {
    let prevStack: CallTreeNode[] = []
    const activeNodes = new Set<CallTreeNode>()
    let value = 0

    let sampleIndex = 0
    for (let stackTop of this.samples) {
      // Find lowest common ancestor of the current stack and the previous one
      let lca: CallTreeNode | null = null

      // Active membership makes this linear in the newly opened stack height.
      for (
        lca = stackTop;
        lca && lca.frame != Frame.root && !activeNodes.has(lca);
        lca = lca.parent
      ) {}

      // Close frames that are no longer open
      while (prevStack.length > 0 && lastOf(prevStack) != lca) {
        const node = prevStack.pop()!
        activeNodes.delete(node)
        yield {node, value, open: false}
      }

      // Open frames that are now becoming open
      const toOpen: CallTreeNode[] = []
      for (
        let node: CallTreeNode | null = stackTop;
        node && node.frame != Frame.root && node != lca;
        node = node.parent
      ) {
        toOpen.push(node)
      }
      toOpen.reverse()

      for (let node of toOpen) {
        yield {node, value, open: true}
        activeNodes.add(node)
        prevStack.push(node)
      }
      value += this.weights[sampleIndex++]
    }

    // Close frames that are open at the end of the trace
    for (let i = prevStack.length - 1; i >= 0; i--) {
      yield {node: prevStack[i], value, open: false}
    }
  }

  forEachFrame(fn: (frame: Frame) => void) {
    this.frames.forEach(fn)
  }

  getFrames(): Iterable<Frame> {
    return this.frames
  }

  getFrame(key: string | number): Frame | undefined {
    return this.frames.get(key)
  }

  getProfileWithRecursionFlattened(): Profile {
    const builder = new CallTreeProfileBuilder()

    const stack: (CallTreeNode | null)[] = []
    const framesInStack = new Set<Frame>()

    function openFrame(node: CallTreeNode, value: number) {
      if (framesInStack.has(node.frame)) {
        stack.push(null)
      } else {
        framesInStack.add(node.frame)
        stack.push(node)
        builder.enterFrame(node.frame, value)
      }
    }
    function closeFrame(node: CallTreeNode, value: number) {
      const stackTop = stack.pop()
      if (stackTop) {
        framesInStack.delete(stackTop.frame)
        builder.leaveFrame(stackTop.frame, value)
      }
    }

    this.forEachCall(openFrame, closeFrame)

    const flattenedProfile = builder.build()
    flattenedProfile.name = this.name
    flattenedProfile.valueFormatter = this.valueFormatter

    // When constructing a profile with recursion flattened,
    // counter-intuitive things can happen to "self time" measurements
    // for functions.
    // For example, given the following list of stacks w/ weights:
    //
    // a 1
    // a;b;a 1
    // a;b;a;b;a 1
    // a;b;a 1
    //
    // The resulting profile with recursion flattened out will look like this:
    //
    // a 1
    // a;b 3
    //
    // Which is useful to view, but it's counter-intuitive to move self-time
    // for frames around, since analyzing the self-time of functions is an important
    // thing to be able to do accurately, and we don't want this to change when recursion
    // is flattened. To work around that, we'll just copy the weights directly from the
    // un-flattened profile.
    this.forEachFrame(f => {
      flattenedProfile.frames.getOrInsert(f).overwriteWeightWith(f)
    })

    return flattenedProfile
  }

  getInvertedProfileForCallersOf(focalFrameInfo: FrameInfo): Profile {
    const focalFrame = Frame.getOrInsert(this.frames, focalFrameInfo)
    const builder = new StackListProfileBuilder()

    // TODO(jlfwong): Could construct this at profile
    // construction time rather than on demand.
    const nodes: CallTreeNode[] = []

    visitTree([this.appendOrderCalltreeRoot], node => {
      if (node.frame === focalFrame) {
        nodes.push(node)
        return false
      }
    })

    for (let node of nodes) {
      const stack: FrameInfo[] = []
      for (let n: CallTreeNode | null = node; n != null && n.frame !== Frame.root; n = n.parent) {
        stack.push(n.frame)
      }
      builder.appendSampleWithWeight(stack, node.getTotalWeight())
    }

    const ret = builder.build()
    ret.name = this.name
    ret.valueFormatter = this.valueFormatter
    return ret
  }

  getProfileForCalleesOf(focalFrameInfo: FrameInfo): Profile {
    const focalFrame = Frame.getOrInsert(this.frames, focalFrameInfo)
    const builder = new StackListProfileBuilder()

    function recordSubtree(focalFrameNode: CallTreeNode) {
      const stack: FrameInfo[] = []

      visitTree([focalFrameNode], (node, depth) => {
        stack.length = depth
        stack.push(node.frame)
        builder.appendSampleWithWeight(stack, node.getSelfWeight())
      })
    }

    visitTree([this.appendOrderCalltreeRoot], node => {
      if (node.frame === focalFrame) {
        recordSubtree(node)
        return false
      }
    })

    const ret = builder.build()
    ret.name = this.name
    ret.valueFormatter = this.valueFormatter
    return ret
  }

  // Demangle symbols for readability
  async demangle() {
    let demangle: ((name: string) => string) | null = null

    for (let frame of this.frames) {
      // This function converts a mangled C++ and Rust name into a human-readable symbol.
      if (
        frame.name.startsWith('__Z') ||
        frame.name.startsWith('_R') ||
        frame.name.startsWith('_Z')
      ) {
        if (!demangle) {
          const demangleModule = await import('./demangle')
          demangle = await demangleModule.loadDemangling()
        }
        frame.name = demangle(frame.name)
      }
    }
  }

  remapSymbols(callback: SymbolRemapper) {
    for (let frame of this.frames) {
      const remapped = callback(frame)
      if (remapped == null) {
        continue
      }
      const {name, file, line, col} = remapped
      if (name != null) {
        frame.name = name
      }
      if (file != null) {
        frame.file = file
      }
      if (line != null) {
        frame.line = line
      }
      if (col != null) {
        frame.col = col
      }
    }
  }
}

export class StackListProfileBuilder extends Profile {
  private groupedIndex = new GroupedCallTreeIndex()

  _appendSample(stack: Frame[], weight: number, useAppendOrder: boolean) {
    if (isNaN(weight)) throw new Error('invalid weight')
    let node = useAppendOrder ? this.appendOrderCalltreeRoot : this.groupedCalltreeRoot

    const framesInStack = useAppendOrder ? new Set<Frame>() : null

    for (let frame of stack) {
      if (!useAppendOrder) {
        node = this.groupedIndex.getOrCreate(node, frame)
      } else {
        const last = lastOf(node.children)
        if (last && !last.isFrozen() && last.frame === frame) {
          node = last
        } else {
          const parent = node
          node = new CallTreeNode(frame, node)
          parent.children.push(node)
        }
      }
      node.addToTotalWeight(weight)

      // It's possible for the same frame to occur multiple
      // times in the same call stack due to either direct
      // or indirect recursion. We want to avoid counting that
      // frame multiple times for a single sample, we so just
      // track all of the unique frames that participated in
      // this call stack, then add to their weight at the end.
      if (framesInStack) framesInStack.add(node.frame)
    }
    node.addToSelfWeight(weight)

    if (useAppendOrder) {
      for (let child of node.children) {
        child.freeze()
      }
    }

    if (useAppendOrder) {
      node.frame.addToSelfWeight(weight)

      for (let frame of framesInStack!) {
        frame.addToTotalWeight(weight)
      }

      if (node === lastOf(this.samples)) {
        this.weights[this.weights.length - 1] += weight
      } else {
        this.samples.push(node)
        this.weights.push(weight)
      }
    }
  }

  appendSampleWithWeight(stack: FrameInfo[], weight: number) {
    if (weight === 0) {
      // Samples with zero weight have no effect, so let's ignore them
      return
    }
    if (weight < 0) {
      throw new Error('Samples must have positive weights')
    }

    const frames = stack.map(fr => Frame.getOrInsert(this.frames, fr))
    this._appendSample(frames, weight, true)
    this._appendSample(frames, weight, false)
  }

  private pendingSample: {
    stack: FrameInfo[]
    startTimestamp: number
    centralTimestamp: number
  } | null = null
  appendSampleWithTimestamp(stack: FrameInfo[], timestamp: number) {
    if (this.pendingSample) {
      if (timestamp < this.pendingSample.centralTimestamp) {
        throw new Error('Timestamps received out of order')
      }
      const endTimestamp = (timestamp + this.pendingSample.centralTimestamp) / 2
      this.appendSampleWithWeight(
        this.pendingSample.stack,
        endTimestamp - this.pendingSample.startTimestamp,
      )
      this.pendingSample = {stack, startTimestamp: endTimestamp, centralTimestamp: timestamp}
    } else {
      this.pendingSample = {stack, startTimestamp: timestamp, centralTimestamp: timestamp}
    }
  }

  build(): Profile {
    if (this.pendingSample) {
      if (this.samples.length > 0) {
        this.appendSampleWithWeight(
          this.pendingSample.stack,
          this.pendingSample.centralTimestamp - this.pendingSample.startTimestamp,
        )
      } else {
        // There is only a single sample. In this case, units will be meaningless,
        // so we'll append with a weight of 1 and also clear any value formatter
        this.appendSampleWithWeight(this.pendingSample.stack, 1)
        this.setValueFormatter(new RawValueFormatter())
      }
    }
    this.totalWeight = Math.max(
      this.totalWeight,
      this.weights.reduce((a, b) => a + b, 0),
    )
    this.sortGroupedCallTree()
    this.groupedIndex.clear()
    return this
  }
}

// As an alternative API for importing profiles more efficiently, provide a
// way to open & close frames directly without needing to construct tons of
// arrays as intermediaries.
export class CallTreeProfileBuilder extends Profile {
  private groupedIndex = new GroupedCallTreeIndex()
  private appendOrderStack: CallTreeNode[] = [this.appendOrderCalltreeRoot]
  private groupedOrderStack: CallTreeNode[] = [this.groupedCalltreeRoot]
  private framesInStack = new Map<Frame, number>()
  private stack: Frame[] = []

  private lastValue: number = 0
  private addWeightsToFrames(value: number) {
    const delta = value - this.lastValue
    if (delta === 0) return
    for (let frame of this.framesInStack.keys()) {
      frame.addToTotalWeight(delta)
    }
    const stackTop = lastOf(this.stack)
    if (stackTop) {
      stackTop.addToSelfWeight(delta)
    }
  }
  private addWeightsToNodes(value: number, stack: CallTreeNode[]) {
    const delta = value - this.lastValue
    if (delta === 0) return
    for (let node of stack) {
      node.addToTotalWeight(delta)
    }
    const stackTop = lastOf(stack)
    if (stackTop) {
      stackTop.addToSelfWeight(delta)
    }
  }

  private _enterFrame(frame: Frame, value: number, useAppendOrder: boolean) {
    let stack = useAppendOrder ? this.appendOrderStack : this.groupedOrderStack
    this.addWeightsToNodes(value, stack)

    let prevTop = lastOf(stack)

    if (prevTop) {
      if (useAppendOrder) {
        const delta = value - this.lastValue
        if (delta > 0) {
          this.samples.push(prevTop)
          this.weights.push(value - this.lastValue)
        } else if (delta < 0) {
          throw new Error(
            `Samples must be provided in increasing order of cumulative value. Last sample was ${this.lastValue}, this sample was ${value}`,
          )
        }
      }

      let node: CallTreeNode
      if (!useAppendOrder) {
        node = this.groupedIndex.getOrCreate(prevTop, frame)
      } else {
        const last = lastOf(prevTop.children)
        if (last && !last.isFrozen() && last.frame === frame) {
          node = last
        } else {
          node = new CallTreeNode(frame, prevTop)
          prevTop.children.push(node)
        }
      }
      stack.push(node)
    }
  }
  enterFrame(frameInfo: FrameInfo, value: number) {
    const frame = Frame.getOrInsert(this.frames, frameInfo)
    this.addWeightsToFrames(value)
    this._enterFrame(frame, value, true)
    this._enterFrame(frame, value, false)

    this.stack.push(frame)
    const frameCount = this.framesInStack.get(frame) || 0
    this.framesInStack.set(frame, frameCount + 1)
    this.lastValue = value
    this.totalWeight = Math.max(this.totalWeight, this.lastValue)
  }

  private _leaveFrame(frame: Frame, value: number, useAppendOrder: boolean) {
    let stack = useAppendOrder ? this.appendOrderStack : this.groupedOrderStack
    this.addWeightsToNodes(value, stack)

    if (useAppendOrder) {
      const leavingStackTop = this.appendOrderStack.pop()
      if (leavingStackTop == null) {
        throw new Error(`Trying to leave ${frame.key} when stack is empty`)
      }
      if (this.lastValue == null) {
        throw new Error(`Trying to leave a ${frame.key} before any have been entered`)
      }
      leavingStackTop.freeze()

      if (leavingStackTop.frame.key !== frame.key) {
        throw new Error(
          `Tried to leave frame "${frame.name}" while frame "${leavingStackTop.frame.name}" was at the top at ${value}`,
        )
      }

      const delta = value - this.lastValue
      if (delta > 0) {
        this.samples.push(leavingStackTop)
        this.weights.push(value - this.lastValue)
      } else if (delta < 0) {
        throw new Error(
          `Samples must be provided in increasing order of cumulative value. Last sample was ${this
            .lastValue!}, this sample was ${value}`,
        )
      }
    } else {
      this.groupedOrderStack.pop()
    }
  }

  leaveFrame(frameInfo: FrameInfo, value: number) {
    const frame = Frame.getOrInsert(this.frames, frameInfo)
    this.addWeightsToFrames(value)

    this._leaveFrame(frame, value, true)
    this._leaveFrame(frame, value, false)

    this.stack.pop()
    const frameCount = this.framesInStack.get(frame)
    if (frameCount == null) return
    if (frameCount === 1) {
      this.framesInStack.delete(frame)
    } else {
      this.framesInStack.set(frame, frameCount - 1)
    }
    this.lastValue = value

    this.totalWeight = Math.max(this.totalWeight, this.lastValue)
  }

  build(): Profile {
    // Each stack is expected to contain a single node which we initialize to be
    // the root node.
    if (this.appendOrderStack.length > 1 || this.groupedOrderStack.length > 1) {
      throw new Error('Tried to complete profile construction with a non-empty stack')
    }
    this.sortGroupedCallTree()
    this.groupedIndex.clear()
    return this
  }
}
