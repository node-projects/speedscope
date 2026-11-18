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

function* parseEvents(contents: TextFileContent): Generator<PerfEvent | null> {
  let buffer: string[] = []
  for (let line of contents.splitLines()) {
    if (line === '') {
      yield parseEvent(buffer)
      buffer = []
    } else buffer.push(line)
  }

  if (buffer.length > 0) yield parseEvent(buffer)
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
  const eventStartMatch = /^(\S.*?)\s+(\d+)(?:\/(\d+))?\s+/.exec(firstLine)
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
  if (timeMatch) {
    event.time = parseFloat(timeMatch[1])
    const period = /^(\d+)\s+\S+:/.exec(firstLine.slice(timeMatch.index + timeMatch[0].length))
    if (period) event.period = Number(period[1])
  }

  const evName = /(\S+):\s*$/.exec(firstLine)
  if (evName) {
    event.eventType = normalizeEventType(evName[1])
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

  return event
}

export function importFromLinuxPerf(contents: TextFileContent): ProfileGroup | null {
  const profiles = new Map<
    string,
    {builder: StackListProfileBuilder; name: string; type: string; counter: boolean}
  >()
  const eventTypes = new Set<string>()
  let missingStacks = false

  for (let event of parseEvents(contents)) {
    if (event == null) continue
    if (event.time == null) continue
    if (event.stack.length === 0) {
      missingStacks = true
      continue
    }
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

  if (profiles.size === 0) {
    if (missingStacks)
      throw new Error(
        'perf output contains no call stacks. Record with -g and use perf script without --hide-call-graph.',
      )
    return null
  }

  for (const state of profiles.values()) {
    if (eventTypes.size > 1 || state.counter) state.builder.setName(`${state.name} [${state.type}]`)
  }

  return {
    name: profiles.size === 1 ? Array.from(profiles.values())[0].builder.getName() : '',
    indexToView: 0,
    profiles: Array.from(itMap(profiles.values(), state => state.builder.build())),
  }
}
