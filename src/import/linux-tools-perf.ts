import {StackListProfileBuilder, ProfileGroup} from '../lib/profile'
import {itMap, getOrInsert} from '../lib/utils'
import {TimeFormatter, RawValueFormatter} from '../lib/value-formatters'
import {TextFileContent} from './utils'

// This imports the output of the "perf script" command on linux.
//
// Reference: https://github.com/torvalds/linux/blob/0fbc4aea/tools/perf/builtin-script.c#L1622
// Reference: https://github.com/brendangregg/FlameGraph/blob/18c3dea/stackcollapse-perf.pl#L163

interface PerfStackFrame {
  address: string
  symbolName: string
  file: string
}

interface PerfEvent {
  command: string | null
  processID: number | null
  threadID: number | null
  time: number | null
  eventType: string
  period: number | null
  stack: PerfStackFrame[]
}

function normalizeEventType(eventType: string): string {
  // Hybrid CPUs name otherwise identical events after their core PMU.
  return eventType.replace(
    /^cpu_(?:core|atom)\/(.+)\/([a-zA-Z]*)$/,
    (_, name, flags) => name + (flags ? `:${flags}` : ''),
  )
}

// rawEvent is splitted into lines
function parseEvent(rawEvent: string[]): PerfEvent | null {
  const lines = rawEvent.filter(l => !/^\s*#/.exec(l))

  const event: PerfEvent = {
    command: null,
    processID: null,
    threadID: null,
    time: null,
    eventType: '',
    period: null,
    stack: [],
  }

  const firstLine = lines.shift()
  if (!firstLine) return null

  // Note: command name may contain spaces, e.g.
  //
  //  V8 WorkerThread 25607 4794564.109216: cycles:
  const eventStartMatch = /^\s*(\S.*?)\s+(\d+)(?:\/(\d+))?\s+/.exec(firstLine)
  if (!eventStartMatch) return null

  event.command = eventStartMatch[1]

  // default "perf script" output has TID but not PID
  if (eventStartMatch[3]) {
    event.processID = parseInt(eventStartMatch[2], 10)
    event.threadID = parseInt(eventStartMatch[3], 10)
  } else {
    event.threadID = parseInt(eventStartMatch[2], 10)
  }

  const timeMatch = /\s+(\d+\.\d+):\s+/.exec(firstLine)
  let inlineFrame: PerfStackFrame | null = null
  if (timeMatch) {
    event.time = parseFloat(timeMatch[1])
    const fields = /^(?:(\d+)\s+)?(\S+):(?:\s+(.*))?$/.exec(
      firstLine.slice(timeMatch.index + timeMatch[0].length),
    )
    if (fields) {
      if (fields[1]) event.period = Number(fields[1])
      event.eventType = normalizeEventType(fields[2])
      // With --hide-call-graph perf prints the sampled IP, symbol and DSO on
      // the header itself. Keep this leaf only when no real callchain follows.
      // See Linux tools/perf/builtin-script.c: no_callchain and PERF_OUTPUT_IP.
      const leaf = /^([\da-f]+)\s+(.+) \(([^()]*)\)\s*$/i.exec(fields[3] || '')
      if (leaf)
        inlineFrame = {
          address: `0x${leaf[1]}`,
          symbolName: leaf[2].replace(/\+0x[\da-f]+$/i, ''),
          file: leaf[3],
        }
    }
  }

  for (let line of lines) {
    const lineMatch = /^\s*(\w+)\s*(.+) \((\S*)\)/.exec(line)
    if (!lineMatch) continue
    let [, address, symbolName, file] = lineMatch

    // Linux 4.8 included symbol offsets in perf script output by default, eg:
    // 7fffb84c9afc cpu_startup_entry+0x800047c022ec ([kernel.kallsyms])
    // strip these off:
    symbolName = symbolName.replace(/\+0x[\da-f]+$/, '')

    event.stack.push({address: `0x${address}`, symbolName, file})
  }
  event.stack.reverse()
  if (event.stack.length === 0 && inlineFrame) event.stack.push(inlineFrame)

  return event
}

export interface LinuxPerfParserOptions {
  maxPendingChars?: number
  maxStackDepth?: number
  maxSamples?: number
}

// Sync and streaming callers share sample identity and weight semantics. Only
// the current event's lines are retained in addition to the output builders.
export function createLinuxPerfParser(options: LinuxPerfParserOptions = {}) {
  const profiles = new Map<
    string,
    {builder: StackListProfileBuilder; name: string; type: string; counter: boolean}
  >()
  const eventTypes = new Set<string>()
  let missingStacks = false
  let pending: string[] = []
  let pendingChars = 0
  let samples = 0

  const accept = (event: PerfEvent | null) => {
    if (event == null || event.time == null) return
    if (!Number.isFinite(event.time) || (event.period !== null && !Number.isFinite(event.period)))
      throw new Error('perf timestamps and event periods must be finite numbers')
    if (event.stack.length === 0) {
      missingStacks = true
      return
    }
    if (event.stack.length > (options.maxStackDepth ?? Infinity))
      throw new Error('Streaming text import limit exceeded (stack depth)')
    if (++samples > (options.maxSamples ?? Infinity))
      throw new Error('Streaming text import limit exceeded (sample count)')
    eventTypes.add(event.eventType)

    let profileNameParts = []
    if (event.command) profileNameParts.push(event.command)
    if (event.processID != null) profileNameParts.push(`pid: ${event.processID}`)
    if (event.threadID != null) profileNameParts.push(`tid: ${event.threadID}`)
    const profileName = profileNameParts.join(' ')
    const counter = !/^(?:cycles|cpu-clock|task-clock)(?::.*)?$/.test(event.eventType)
    const builderState = getOrInsert(
      profiles,
      JSON.stringify([profileName, event.eventType]),
      () => {
        const builder = new StackListProfileBuilder()
        builder.setName(profileName)
        builder.setValueFormatter(counter ? new RawValueFormatter() : new TimeFormatter('seconds'))
        return {builder, name: profileName, type: event.eventType, counter}
      },
    )

    const builder = builderState.builder
    const stack = event.stack.map(({symbolName, file}) => {
      return {
        key: `${symbolName} (${file})`,
        name: symbolName === '[unknown]' ? `??? (${file})` : symbolName,
        file: file,
      }
    })
    if (counter) builder.appendSampleWithWeight(stack, event.period ?? 1)
    else builder.appendSampleWithTimestamp(stack, event.time)
  }

  const flush = () => {
    if (pending.length) accept(parseEvent(pending))
    pending = []
    pendingChars = 0
  }
  const pushLine = (inputLine: string) => {
    const line = inputLine.replace(/\r$/, '')
    // --hide-call-graph samples have consecutive headers without blank lines.
    if (/^\s*(\S.*?)\s+(\d+)(?:\/(\d+))?\s+/.test(line) && /\s+\d+\.\d+:\s+/.test(line)) flush()
    else if (!line.trim()) {
      flush()
      return
    }
    pendingChars += line.length + 1
    if (pendingChars > (options.maxPendingChars ?? Infinity))
      throw new Error('Streaming text import limit exceeded (perf event size)')
    pending.push(line)
  }
  const build = (): ProfileGroup | null => {
    flush()
    if (profiles.size === 0) {
      if (missingStacks)
        throw new Error(
          'perf output contains no call stacks or sampled symbols. Record with -g and use perf script without --hide-call-graph, or include ip,sym,dso fields for leaf-only samples.',
        )
      return null
    }
    for (const state of profiles.values()) {
      if (eventTypes.size > 1 || state.counter)
        state.builder.setName(`${state.name} [${state.type}]`)
    }
    return {
      name: profiles.size === 1 ? Array.from(profiles.values())[0].builder.getName() : '',
      indexToView: 0,
      profiles: Array.from(itMap(profiles.values(), state => state.builder.build())),
    }
  }
  return {pushLine, build}
}

export function importFromLinuxPerf(contents: TextFileContent): ProfileGroup | null {
  const parser = createLinuxPerfParser()
  for (const line of contents.splitLines()) parser.pushLine(line)
  return parser.build()
}
