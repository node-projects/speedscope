import {FrameInfo, ProfileGroup, StackListProfileBuilder} from '../lib/profile'
import {TextFileContent} from './utils'

// difffolded.pl emits two nonnegative counts, not a signed sample weight.
// Use explicit format selection: an ordinary folded symbol can itself end in
// a number, so sniffing two trailing numbers would change valid frame names.
export function isDifferentialFoldedName(name: string): boolean {
  return /\.(?:diff|differential)\.(?:folded|collapsed|stacks)(?:\.gz)?$/i.test(name)
}

export function createDifferentialFoldedParser(name: string, maxStackDepth = 65536) {
  const baseline = new StackListProfileBuilder()
  const candidate = new StackListProfileBuilder()
  baseline.setName(`${name} — Baseline`)
  candidate.setName(`${name} — Candidate`)
  baseline.setChronological(false)
  candidate.setChronological(false)
  let count = 0,
    baselineTotal = 0,
    candidateTotal = 0
  return {
    pushLine(line: string) {
      if (!line.trim() || /^\s*#/.test(line)) return false
      const match = /^(.*\S)[ \t]+(\S+)[ \t]+(\S+)[ \t]*\r?$/.exec(line)
      if (!match)
        throw new Error('Differential folded input requires a stack and two weights per line')
      const first = Number(match[2]),
        second = Number(match[3])
      const numeric = /^[+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
      if (
        !numeric.test(match[2]) ||
        !numeric.test(match[3]) ||
        !Number.isFinite(first) ||
        !Number.isFinite(second)
      )
        throw new Error('Differential folded weights must be finite nonnegative numbers')
      baselineTotal += first
      candidateTotal += second
      if (!Number.isFinite(baselineTotal) || !Number.isFinite(candidateTotal))
        throw new Error('Differential folded total weight overflow')
      let depth = 1
      for (let at = 0; (at = match[1].indexOf(';', at)) !== -1; at++)
        if (++depth > maxStackDepth)
          throw new Error('Differential folded stack depth limit exceeded')
      const stack: FrameInfo[] = match[1].split(';').map(label => ({key: label, name: label}))
      baseline.appendSampleWithWeight(stack, first)
      candidate.appendSampleWithWeight(stack, second)
      count++
      return true
    },
    build(): ProfileGroup | null {
      return count ? {name, indexToView: 0, profiles: [baseline.build(), candidate.build()]} : null
    },
  }
}

export function importFromBGDifferential(
  contents: TextFileContent,
  name: string,
): ProfileGroup | null {
  const parser = createDifferentialFoldedParser(name)
  let count = 0
  for (const line of contents.splitLines()) {
    if (line.length > 1024 * 1024) throw new Error('Differential folded line size limit exceeded')
    if (parser.pushLine(line) && ++count > 2_000_000)
      throw new Error('Differential folded sample count limit exceeded')
  }
  return parser.build()
}
