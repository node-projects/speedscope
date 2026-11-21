import {FrameInfo, ProfileGroup, StackListProfileBuilder} from '../lib/profile'
import {TextFileContent} from './utils'

// HotSpot's traditional jstack/Thread.print text format. Reference examples:
// https://docs.oracle.com/en/java/javase/21/troubleshoot/troubleshooting-guide.pdf
// https://github.com/openjdk/jdk/blob/master/test/hotspot/jtreg/serviceability/tmtools/jstack/utils/DefaultFormat.java
// This is an independently implemented parser, not OpenJDK parser code.
export function isJavaThreadDump(text: string): boolean {
  return /(?:^|\n)\uFEFF?Full thread dump [^\r\n]+/.test(text)
}

interface ThreadObservation {
  identity: string
  label: string
  frames: FrameInfo[]
}

function parseThreadHeader(line: string): ThreadObservation | null {
  const match = /^"(.*)"\s+(.+)$/.exec(line)
  if (!match) return null
  const tid = /(?:^|\s)tid=(0x[\da-f]+)(?=\s|$)/i.exec(match[2])
  const nid = /(?:^|\s)nid=(?:0x[\da-f]+|\d+)(?=\s|$)/i.exec(match[2])
  if (!tid || !nid) return null
  const javaId = /(?:^|\s)#(\d+)(?=\s|$)/.exec(match[2])
  const id = javaId
    ? '#' + javaId[1].replace(/^0+(?=\d)/, '')
    : 'tid ' + tid[1].toLowerCase().replace(/^0x0+(?=[\da-f])/, '0x')
  const name = match[1] || '(unnamed Java thread)'
  // Include the name: renamed threads remain distinct instead of silently
  // assigning an old name to later observations. A file should concern one JVM.
  return {identity: JSON.stringify([match[1], id]), label: `${name} (${id})`, frames: []}
}

function parseJavaFrame(line: string): FrameInfo | null {
  const match = /^\s+at\s+([^\s()]+)\((.*)\)\s*$/.exec(line)
  if (!match) return null
  const name = match[1],
    source = match[2]
  const frame: FrameInfo = {key: JSON.stringify([name, source]), name}
  if (source !== 'Native Method' && source !== 'Unknown Source' && source !== '') {
    const location = /^(.*):(\d+)$/.exec(source)
    frame.file = location ? location[1] : source
    if (location) {
      const lineNumber = Number(location[2])
      if (Number.isSafeInteger(lineNumber) && lineNumber > 0) frame.line = lineNumber
    }
  }
  return frame
}

// Every observed Java stack has weight 1 in raw sample units. Snapshot time,
// state/lock text and CPU/elapsed fields do not imply measured execution time.
// Missing threads and entries with no Java stack add no samples. Builders hold
// only the output model; the parser retains one current stack and one snapshot's
// identities instead of an array containing every line or observation.
export function importFromJavaThreadDump(
  contents: TextFileContent,
  name: string,
): ProfileGroup | null {
  const builders = new Map<string, StackListProfileBuilder>()
  let current: ThreadObservation | null = null
  let inDump = false
  let sawFrame = false
  const seen = new Set<string>()
  const flush = () => {
    if (current?.frames.length) {
      let builder = builders.get(current.identity)
      if (!builder) {
        builder = new StackListProfileBuilder()
        builder.setName(current.label)
        builder.setChronological(false)
        builders.set(current.identity, builder)
      }
      // jstack prints the leaf first, while profile stacks start at the root.
      builder.appendSampleWithWeight(current.frames.reverse(), 1)
      sawFrame = true
    }
    current = null
  }
  for (const raw of contents.splitLines()) {
    const line = raw.replace(/\r$/, '').replace(/^\uFEFF/, '')
    if (/^Full thread dump [^\r\n]+/.test(line)) {
      flush()
      inDump = true
      seen.clear()
      continue
    }
    if (!inDump) continue
    // jstack repeats stacks in deadlock summaries. They are diagnostic text,
    // not another observation; only a new Full thread dump opens a snapshot.
    if (/^Found (?:one|\d+) Java-level deadlocks?:/.test(line)) {
      flush()
      inDump = false
      continue
    }
    const header = parseThreadHeader(line)
    if (header) {
      flush()
      if (seen.has(header.identity))
        throw new Error(
          'Duplicate thread in one Java dump; separate captures with Full thread dump headers',
        )
      seen.add(header.identity)
      current = header
      continue
    }
    if (line.startsWith('"')) throw new Error('Invalid thread header in Java thread dump')
    if (!line.trim()) {
      // Blank separation before the first frame is harmless. After a stack,
      // it closes the observation; later orphan frames must not be silently
      // attached to the previous thread or discarded from a partial import.
      if (current?.frames.length) flush()
      continue
    }
    if (/^\s+at(?:\s|$)/.test(line)) {
      if (!current) throw new Error('Java stack frame has no thread header')
      const frame = parseJavaFrame(line)
      if (!frame) throw new Error('Invalid Java stack frame in thread dump')
      current.frames.push(frame)
    }
  }
  flush()
  return sawFrame
    ? {name, indexToView: 0, profiles: [...builders.values()].map(b => b.build())}
    : null
}
