import type {CallTreeEvent, CallTreeNode} from './profile'

export const CALL_EVENT_INDEX_MAX_CHECKPOINTS = 4096
export interface CallEventRangeIndexOptions {
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}

// Indexes refer to the completed profile's existing arrays/nodes. Checkpoints
// retain only a sample ordinal and the exact sequentially accumulated clock,
// never a separate ancestor stack or interval object per sample/checkpoint.
export class ProfileCallEventRangeIndex {
  private constructor(
    private readonly samples: readonly CallTreeNode[],
    private readonly weights: readonly number[],
    private readonly clocks: Float64Array,
    private readonly positions: Uint32Array,
    private readonly isCurrent: () => boolean,
  ) {}

  get checkpointCount() {
    return this.clocks.length
  }
  get byteLength() {
    return this.clocks.byteLength + this.positions.byteLength
  }

  static async create(
    samples: readonly CallTreeNode[],
    weights: readonly number[],
    isCurrent: () => boolean,
    options: CallEventRangeIndexOptions = {},
  ): Promise<ProfileCallEventRangeIndex> {
    const check = () => {
      if (options.signal?.aborted)
        throw new DOMException('Timeline indexing cancelled', 'AbortError')
      if (!isCurrent()) throw new Error('Profile changed during timeline indexing')
    }
    check()
    if (samples.length !== weights.length) throw new Error('Invalid timeline sample dimensions')
    const stride = Math.max(1, Math.ceil(samples.length / CALL_EVENT_INDEX_MAX_CHECKPOINTS))
    const count = Math.ceil(samples.length / stride)
    const clocks = new Float64Array(count),
      positions = new Uint32Array(count)
    let value = 0,
      checkpoint = 0,
      lastYield = performance.now()
    for (let index = 0; index < samples.length; index++) {
      if (index % stride === 0) {
        clocks[checkpoint] = value
        positions[checkpoint++] = index
      }
      const weight = weights[index]
      if (!Number.isFinite(weight) || weight < 0)
        throw new Error('Timeline weights must be finite and nonnegative')
      // Deliberately identical addition order to Profile.getCallEvents().
      value += weight
      if (!Number.isFinite(value)) throw new Error('Timeline sample clock overflow')
      if ((index & 4095) === 4095) {
        check()
        if (options.yieldControl || performance.now() - lastYield >= 8) {
          await (options.yieldControl
            ? options.yieldControl()
            : new Promise(resolve => setTimeout(resolve, 0)))
          check()
          lastYield = performance.now()
        }
      }
    }
    check()
    return new ProfileCallEventRangeIndex(samples, weights, clocks, positions, isCurrent)
  }

  // Ancestors already active at the chosen checkpoint open at its clock, which
  // is <= startValue (or zero for negative seeks). These openings initialize
  // the clipped view and are not their
  // original call starts. Consumers MUST clip intervals to their viewport.
  *getCallEvents(startValue: number): IterableIterator<CallTreeEvent> {
    if (!Number.isFinite(startValue)) throw new Error('Timeline seek must be finite')
    if (!this.isCurrent()) throw new Error('Profile changed after timeline indexing')
    if (!this.positions.length) return
    let low = 0,
      high = this.clocks.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.clocks[middle] <= startValue) low = middle + 1
      else high = middle
    }
    const checkpoint = Math.max(0, low - 1)
    let value = this.clocks[checkpoint]
    const stack: CallTreeNode[] = []
    const active = new Set<CallTreeNode>()
    for (let index = this.positions[checkpoint]; index < this.samples.length; index++) {
      if ((index & 1023) === 0 && !this.isCurrent())
        throw new Error('Profile changed after timeline indexing')
      const top = this.samples[index]
      let ancestor: CallTreeNode | null = top
      for (; ancestor?.parent && !active.has(ancestor); ancestor = ancestor.parent) {}
      while (stack.length && stack[stack.length - 1] !== ancestor) {
        const closing = stack.pop()!
        active.delete(closing)
        yield {node: closing, value, open: false}
      }
      const opening: CallTreeNode[] = []
      for (
        let current: CallTreeNode | null = top;
        current?.parent && current !== ancestor;
        current = current.parent
      )
        opening.push(current)
      for (let at = opening.length - 1; at >= 0; at--) {
        const current = opening[at]
        stack.push(current)
        active.add(current)
        yield {node: current, value, open: true}
      }
      value += this.weights[index]
    }
    for (let index = stack.length - 1; index >= 0; index--)
      yield {node: stack[index], value, open: false}
  }
}
