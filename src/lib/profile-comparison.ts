import {CallTreeNode, Frame, FrameInfo, Profile} from './profile'
import {FileFormat} from './file-format-spec'

export type ComparisonMode = 'absolute' | 'normalized'
export type ComparisonFrame = Readonly<Pick<FrameInfo, 'name' | 'file' | 'line' | 'col'>>
export interface ComparisonNode {
  id: number
  depth: number
  parent: ComparisonNode | null
  frame: ComparisonFrame | null
  children: ComparisonNode[]
  baselineSelf: number
  baselineTotal: number
  candidateSelf: number
  candidateTotal: number
  selfDelta: number
  totalDelta: number
  // Additive layout measure: max(side self)+sum(child envelopes). It is not
  // execution time, and can exceed either recording's measured total.
  envelope: number
}
export interface ProfileComparison {
  mode: ComparisonMode
  unit: FileFormat.ValueUnit
  baselineName: string
  candidateName: string
  baselineUnit: FileFormat.ValueUnit
  candidateUnit: FileFormat.ValueUnit
  // Original, unscaled profile totals. Node values are scaled in normalized
  // mode, dividing each side by its own full profile total, including idle.
  baselineTotal: number
  candidateTotal: number
  root: ComparisonNode
  nodes: ComparisonNode[]
  maxAbsDelta: number
}
export type ComparisonModel = ProfileComparison
export const PROFILE_COMPARISON_LIMITS = Object.freeze({
  nodes: 500000,
  inputNodes: 2000000,
  identityChars: 8 * 1024 * 1024,
  identityLength: 65536,
  pageSize: 200,
})
export interface ProfileComparisonOptions {
  mode: ComparisonMode
  signal?: AbortSignal
  maxNodes?: number
}
function fail(message: string): never {
  throw new Error(`Profile comparison: ${message}`)
}
function weight(value: number): number {
  if (!Number.isFinite(value) || value < 0) fail('source weights must be finite and nonnegative')
  return value
}
function finiteSum(a: number, b: number): number {
  const sum = a + b
  if (!Number.isFinite(sum)) fail('comparison weights overflow; use normalized composition mode')
  return sum
}
function node(
  id: number,
  parent: ComparisonNode | null,
  frame: ComparisonFrame | null,
): ComparisonNode {
  return {
    id,
    parent,
    frame,
    depth: parent ? parent.depth + 1 : 0,
    children: [],
    baselineSelf: 0,
    baselineTotal: 0,
    candidateSelf: 0,
    candidateTotal: 0,
    selfDelta: 0,
    totalDelta: 0,
    envelope: 0,
  }
}

export async function compareProfiles(
  baseline: Profile,
  candidate: Profile,
  options: ProfileComparisonOptions,
): Promise<ProfileComparison> {
  if (!['absolute', 'normalized'].includes(options.mode)) fail('unknown comparison mode')
  const maximum = options.maxNodes ?? PROFILE_COMPARISON_LIMITS.nodes
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > PROFILE_COMPARISON_LIMITS.nodes)
    fail('invalid node limit')
  const baselineTotal = weight(baseline.getTotalWeight()),
    candidateTotal = weight(candidate.getTotalWeight())
  const baselineUnit = baseline.getWeightUnit(),
    candidateUnit = candidate.getWeightUnit()
  if (options.mode === 'absolute' && baselineUnit !== candidateUnit)
    fail(
      'absolute mode requires matching units; choose normalized composition mode for different units',
    )
  const root = node(0, null, null),
    nodes = [root]
  const sources = new WeakMap<Frame, ComparisonFrame>()
  const identities = new Map<string, ComparisonFrame>()
  const children = new WeakMap<ComparisonNode, Map<ComparisonFrame, ComparisonNode>>()
  let identityChars = 0,
    visits = 0,
    lastYield = performance.now(),
    work = 0
  function checkpoint(): boolean {
    if (options.signal?.aborted)
      throw new DOMException('Profile comparison cancelled', 'AbortError')
    // Check the clock in coarse batches; do not schedule a timer after every
    // batch, which is expensive on platforms with coarse timer resolution.
    return (++work & 1023) === 0 && performance.now() - lastYield >= 8
  }
  const pause = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    lastYield = performance.now()
  }
  function source(frame: Frame): ComparisonFrame {
    const cached = sources.get(frame)
    if (cached) return cached
    if (
      typeof frame.name !== 'string' ||
      (frame.file != null && typeof frame.file !== 'string') ||
      [frame.line, frame.col].some(position => position != null && !Number.isFinite(position))
    )
      fail('invalid source identity')
    // Check before serializing a pathological symbol or path into another string.
    if (frame.name.length + (frame.file?.length || 0) > PROFILE_COMPARISON_LIMITS.identityLength)
      fail('source identity text exceeds its limit')
    const key = JSON.stringify([
      frame.name,
      frame.file ?? null,
      frame.line ?? null,
      frame.col ?? null,
    ])
    let result = identities.get(key)
    if (!result) {
      identityChars += key.length
      if (identityChars > PROFILE_COMPARISON_LIMITS.identityChars)
        fail('source identity text exceeds its limit')
      result = {
        name: frame.name,
        file: frame.file ?? undefined,
        line: frame.line ?? undefined,
        col: frame.col ?? undefined,
      }
      identities.set(key, result)
    }
    sources.set(frame, result)
    return result
  }
  function child(parent: ComparisonNode, frame: ComparisonFrame): ComparisonNode {
    let index = children.get(parent)
    if (!index) {
      index = new Map()
      children.set(parent, index)
    }
    let result = index.get(frame)
    if (!result) {
      if (nodes.length >= maximum)
        fail(`union exceeds ${maximum.toLocaleString('en-US')} nodes; compare smaller profiles`)
      result = node(nodes.length, parent, frame)
      nodes.push(result)
      parent.children.push(result)
      index.set(frame, result)
    }
    return result
  }
  const scaled = (value: number, total: number) => {
    weight(value)
    if (options.mode === 'absolute') return value
    if (!total) {
      if (value) fail('a zero-total profile contains positive weights')
      return 0
    }
    return value / total // Dividing avoids overflow from 1 / very-small-total.
  }
  for (const [profile, total, isBaseline] of [
    [baseline, baselineTotal, true],
    [candidate, candidateTotal, false],
  ] as const) {
    if (checkpoint()) await pause()
    const inputRoot = profile.getGroupedCalltreeRoot()
    if (inputRoot.children.length > PROFILE_COMPARISON_LIMITS.inputNodes)
      fail('input tree visit limit exceeded; compare smaller profiles')
    let nonIdle = 0
    for (const item of inputRoot.children) {
      if (checkpoint()) await pause()
      nonIdle = finiteSum(nonIdle, weight(item.getTotalWeight()))
    }
    const tolerance = Math.max(total, nonIdle) * Number.EPSILON * 16
    if (nonIdle - total > tolerance) fail('non-idle weights exceed the source profile total')
    const idle = scaled(Math.max(0, total - nonIdle), total)
    if (isBaseline) {
      root.baselineSelf = idle
      root.baselineTotal = scaled(total, total)
    } else {
      root.candidateSelf = idle
      root.candidateTotal = scaled(total, total)
    }
    // Iterative depth-first cursors, not a flattened input-node or call-stack array.
    const pending: {input: CallTreeNode; output: ComparisonNode; next: number}[] = [
      {input: inputRoot, output: root, next: 0},
    ]
    while (pending.length) {
      if (checkpoint()) await pause()
      const current = pending[pending.length - 1]
      if (current.next === current.input.children.length) {
        pending.pop()
        continue
      }
      const input = current.input.children[current.next++]
      if (++visits > PROFILE_COMPARISON_LIMITS.inputNodes)
        fail('input-node visits exceed their limit')
      const output = child(current.output, source(input.frame))
      const self = scaled(input.getSelfWeight(), total),
        all = scaled(input.getTotalWeight(), total)
      if (isBaseline) {
        output.baselineSelf = finiteSum(output.baselineSelf, self)
        output.baselineTotal = finiteSum(output.baselineTotal, all)
      } else {
        output.candidateSelf = finiteSum(output.candidateSelf, self)
        output.candidateTotal = finiteSum(output.candidateTotal, all)
      }
      if (input.children.length) pending.push({input, output, next: 0})
    }
  }
  let maxAbsDelta = 0
  // Parents are created before children even for candidate-only paths, so
  // reversing creation order is a bounded, recursion-free postorder.
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (checkpoint()) await pause()
    const current = nodes[i]
    current.selfDelta = current.candidateSelf - current.baselineSelf
    current.totalDelta = current.candidateTotal - current.baselineTotal
    if (!Number.isFinite(current.selfDelta) || !Number.isFinite(current.totalDelta))
      fail('nonfinite signed delta')
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(current.selfDelta), Math.abs(current.totalDelta))
    let envelope = Math.max(current.baselineSelf, current.candidateSelf)
    for (const item of current.children) envelope = finiteSum(envelope, item.envelope)
    current.envelope = envelope
    // Largest paths stay available before a graph's separate drawing budget.
    current.children.sort((a, b) => b.envelope - a.envelope || a.id - b.id)
  }
  if (options.signal?.aborted) throw new DOMException('Profile comparison cancelled', 'AbortError')
  return {
    mode: options.mode,
    unit: options.mode === 'absolute' ? baselineUnit : 'none',
    baselineName: baseline.getName(),
    candidateName: candidate.getName(),
    baselineUnit,
    candidateUnit,
    baselineTotal,
    candidateTotal,
    root,
    nodes,
    maxAbsDelta,
  }
}

export function comparisonNodePage(comparison: ProfileComparison, offset = 0, size = 100) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > PROFILE_COMPARISON_LIMITS.pageSize
  )
    fail('invalid result page')
  return {
    nodes: comparison.nodes.slice(offset, offset + size),
    total: comparison.nodes.length,
    nextOffset: offset + size < comparison.nodes.length ? offset + size : null,
  }
}
