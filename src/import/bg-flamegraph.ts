// https://github.com/brendangregg/FlameGraph#2-fold-stacks

import {Profile, FrameInfo, StackListProfileBuilder} from '../lib/profile'
import {TextFileContent} from './utils'

export interface BGSample {
  stack: FrameInfo[]
  duration: number
}

export function parseBGFoldedStack(line: string, maxStackDepth = Infinity): BGSample | null {
  if (/^\s*#/.test(line)) return null
  const match = /^(.*\S)[ \t]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[ \t]*\r?$/.exec(line)
  if (!match) return null
  const stack = match[1]
  const n = match[2]

  const duration = Number(n)
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error('Folded-stack weights must be finite non-negative numbers')
  }
  if (Number.isFinite(maxStackDepth)) {
    let depth = 1
    for (let at = 0; (at = stack.indexOf(';', at)) !== -1; at++)
      if (++depth > maxStackDepth)
        throw new Error('Streaming text import limit exceeded (stack depth)')
  }
  return {
    stack: stack.split(';').map(name => ({key: name, name: name})),
    duration,
  }
}

export function importFromBGFlameGraph(contents: TextFileContent): Profile | null {
  const profile = new StackListProfileBuilder()
  profile.setChronological(false)
  let count = 0
  for (const line of contents.splitLines()) {
    const sample = parseBGFoldedStack(line)
    if (!sample) continue
    profile.appendSampleWithWeight(sample.stack, sample.duration)
    count++
  }
  return count ? profile.build() : null
}
