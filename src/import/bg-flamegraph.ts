// https://github.com/brendangregg/FlameGraph#2-fold-stacks

import {Profile, FrameInfo, StackListProfileBuilder} from '../lib/profile'
import {TextFileContent} from './utils'

interface BGSample {
  stack: FrameInfo[]
  duration: number
}

function* parseBGFoldedStacks(contents: TextFileContent): IterableIterator<BGSample> {
  for (const line of contents.splitLines()) {
    if (/^\s*#/.test(line)) continue
    const match = /^(.*\S)[ \t]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[ \t]*\r?$/.exec(line)
    if (!match) continue
    const stack = match[1]
    const n = match[2]

    const duration = Number(n)
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('Folded-stack weights must be finite non-negative numbers')
    }
    yield {
      stack: stack.split(';').map(name => ({key: name, name: name})),
      duration,
    }
  }
}

export function importFromBGFlameGraph(contents: TextFileContent): Profile | null {
  const profile = new StackListProfileBuilder()
  profile.setChronological(false)
  let count = 0
  for (const sample of parseBGFoldedStacks(contents)) {
    profile.appendSampleWithWeight(sample.stack, sample.duration)
    count++
  }
  return count ? profile.build() : null
}
