import {FrameInfo, Profile, StackListProfileBuilder} from '../lib/profile'
import {TimeFormatter} from '../lib/value-formatters'

// https://wicg.github.io/js-self-profiling/#the-profilertrace-dictionary
interface JSSelfProfilingData {
  resources: string[]
  frames: {name: string; resourceId?: number; line?: number; column?: number}[]
  stacks: {frameId: number; parentId?: number}[]
  samples: {timestamp: number; stackId?: number}[]
}

export function isJSSelfProfiling(data: any): data is JSSelfProfilingData {
  return ['resources', 'frames', 'stacks', 'samples'].every(key => Array.isArray(data[key]))
}

export function importFromJSSelfProfiling(data: JSSelfProfilingData): Profile {
  const builder = new StackListProfileBuilder()
  builder.setValueFormatter(new TimeFormatter('milliseconds'))
  const frames: FrameInfo[] = data.frames.map((frame, key) => {
    if (typeof frame.name !== 'string') throw new Error('Invalid JS Self-Profiling frame name')
    const file = frame.resourceId == null ? undefined : data.resources[frame.resourceId]
    if (frame.resourceId != null && typeof file !== 'string') {
      throw new Error(`Invalid JS Self-Profiling resource ID: ${frame.resourceId}`)
    }
    return {key, name: frame.name, file, line: frame.line, col: frame.column}
  })
  const stackCache = new Map<number, FrameInfo[]>()
  for (const sample of data.samples) {
    if (!Number.isFinite(sample.timestamp)) throw new Error('Invalid JS Self-Profiling timestamp')
    let stack: FrameInfo[] = []
    if (sample.stackId != null) {
      const cached = stackCache.get(sample.stackId)
      if (cached) {
        stack = cached
      } else {
        const visited = new Set<number>()
        let id: number | undefined = sample.stackId
        while (id != null) {
          if (!Number.isInteger(id) || !data.stacks[id] || visited.has(id)) {
            throw new Error(`Invalid or cyclic JS Self-Profiling stack ID: ${id}`)
          }
          visited.add(id)
          const entry: JSSelfProfilingData['stacks'][number] = data.stacks[id]
          const frame = frames[entry.frameId]
          if (!Number.isInteger(entry.frameId) || !frame) {
            throw new Error(`Invalid JS Self-Profiling frame ID: ${entry.frameId}`)
          }
          stack.push(frame)
          id = entry.parentId
        }
        stack.reverse()
        stackCache.set(sample.stackId, stack)
      }
    }
    // Use the same midpoint weighting as other timestamped sample importers.
    builder.appendSampleWithTimestamp(stack, sample.timestamp)
  }
  return builder.build()
}
