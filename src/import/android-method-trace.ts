import {CallTreeProfileBuilder, FrameInfo, ProfileGroup} from '../lib/profile'
import {TimeFormatter} from '../lib/value-formatters'

// Independently implemented from AOSP VmTraceParser and ART trace.cc, not
// copied parser code. Only the classic concatenated key + SLOW v1-v3 format.
// https://android.googlesource.com/platform/tools/base/+/studio-master-dev/perflib/src/main/java/com/android/tools/perflib/vmtrace/VmTraceParser.java
type Clock = 'thread-cpu' | 'wall' | 'dual'
const MAX_KEY_BYTES = 16 * 1024 * 1024
const MAX_KEY_LINE_BYTES = 1024 * 1024

function fail(message: string): never {
  throw new Error(`Android method trace: ${message}`)
}

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false
  return true
}

export function isAndroidMethodTrace(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  return (
    startsWith(bytes, 0, 'SLOW') ||
    (startsWith(bytes, offset, '*version') && [10, 13].includes(bytes[offset + 8]))
  )
}

function unsignedId(text: string, label: string, maximum = 0xffffffff): number {
  if (!/^(?:0x[\da-f]+|\d+)$/i.test(text)) fail(`invalid ${label}`)
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`invalid ${label}`)
  return value
}

function methodInfo(line: string): FrameInfo {
  const fields = line.includes('\t') ? line.split('\t') : line.split(/\s+/)
  if (![2, 4, 6].includes(fields.length) || fields.some(field => !field))
    fail('invalid method metadata')
  const id = unsignedId(fields[0], 'method ID')
  if ((id & 3) !== 0) fail('method ID must leave its action bits clear')
  const className = fields[1]
  let name = className.replace(/\//g, '.')
  let file: string | undefined, lineNumber: number | undefined
  if (fields.length === 6 || (fields.length === 4 && fields[3].startsWith('('))) {
    if (!fields[3].startsWith('(')) fail('invalid method signature')
    name += '.' + fields[2] + fields[3]
  }
  if (fields.length === 6 || (fields.length === 4 && !fields[3].startsWith('('))) {
    const source = fields[fields.length - 2],
      location = fields[fields.length - 1]
    if (!/^-?\d+$/.test(location) || !Number.isSafeInteger(Number(location)))
      fail('invalid source line')
    const number = Number(location)
    if (number > 0) lineNumber = number
    if (source !== 'Unknown Source' && source !== '(null)' && !/^<.*>$/.test(source)) {
      const slash = className.lastIndexOf('/')
      file =
        slash > 0 && source.endsWith('.java') && !source.includes('/')
          ? className.slice(0, slash + 1) + source
          : source
    }
  }
  return {key: id, name, file, line: file ? lineNumber : undefined}
}

interface Header {
  version: number
  clock: Clock
  threads: Map<number, string>
  methods: Map<number, FrameInfo>
  dataOffset: number
  recordSize: number
  recordCount?: number
}

function readHeader(buffer: ArrayBuffer): Header {
  const bytes = new Uint8Array(buffer)
  if (startsWith(bytes, 0, 'SLOW'))
    fail('streaming/binary-only traces are not supported; use a classic key + data trace')
  const decoder = new TextDecoder('utf-8', {fatal: true})
  let offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const nextLine = () => {
    const start = offset
    while (offset < bytes.length && bytes[offset] !== 10) {
      if (offset >= MAX_KEY_BYTES) fail('key section exceeds 16 MiB')
      if (offset - start >= MAX_KEY_LINE_BYTES) fail('key line exceeds 1 MiB')
      offset++
    }
    if (offset === bytes.length) fail('truncated key section or missing *end marker')
    let text: string
    try {
      text = decoder.decode(bytes.subarray(start, offset))
    } catch {
      fail('key section is not valid UTF-8')
    }
    offset++
    return text.replace(/\r$/, '')
  }
  if (nextLine() !== '*version') fail('missing *version marker')
  const versionText = nextLine()
  if (!/^[123]$/.test(versionText)) fail(`unsupported version ${versionText}`)
  const version = Number(versionText)
  let mode = 'options',
    clock: Clock | undefined
  let recordCount: number | undefined
  const threads = new Map<number, string>(),
    methods = new Map<number, FrameInfo>()
  while (true) {
    const line = nextLine()
    if (line === '*end') break
    if (line === '*threads' || line === '*methods') {
      mode = line.slice(1)
      continue
    }
    if (!line) continue
    if (line.startsWith('*')) fail('unsupported key section ' + line)
    if (mode === 'options') {
      if (line.startsWith('clock=')) {
        if (clock) fail('duplicate clock metadata')
        const value = line.slice(6)
        if (value === 'global' && version === 1) clock = 'wall'
        else if (value === 'wall' || value === 'thread-cpu' || value === 'dual') clock = value
        else fail('unsupported clock ' + value)
      } else if (line.startsWith('num-method-calls=')) {
        if (recordCount !== undefined) fail('duplicate record count metadata')
        const value = line.slice('num-method-calls='.length)
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          fail('invalid record count')
        recordCount = Number(value)
      } else if (!line.includes('=')) fail('invalid trace option')
    } else if (mode === 'threads') {
      const match = /^(\S+)[\t ]+(.+)$/.exec(line)
      if (!match) fail('invalid thread metadata')
      const id = unsignedId(match[1], 'thread ID', version === 1 ? 255 : 65535)
      if (threads.has(id)) fail('duplicate thread ID')
      threads.set(id, match[2])
    } else {
      const frame = methodInfo(line),
        id = frame.key as number
      if (methods.has(id)) fail('duplicate method ID')
      methods.set(id, frame)
    }
  }
  if (!clock) fail('missing explicit clock metadata')
  if (clock === 'dual' && version !== 3) fail('dual clock requires version 3')
  const binaryOffset = offset
  if (bytes.length - binaryOffset < 16 || !startsWith(bytes, binaryOffset, 'SLOW'))
    fail('truncated or invalid SLOW header')
  const view = new DataView(buffer)
  if (view.getUint16(binaryOffset + 4, true) !== version) fail('key/data version mismatch')
  const headerSize = view.getUint16(binaryOffset + 6, true)
  const minimumHeader = version === 3 ? 18 : 16
  if (headerSize < minimumHeader || binaryOffset + headerSize > bytes.length)
    fail('invalid data offset or truncated header')
  const recordSize =
    version === 1 ? 9 : version === 2 ? 10 : view.getUint16(binaryOffset + 16, true)
  const expectedSize = (version === 1 ? 1 : 2) + 8 + (clock === 'dual' ? 4 : 0)
  if (recordSize < expectedSize || recordSize > 65535)
    fail('record size is too small for the selected clock')
  const dataOffset = binaryOffset + headerSize
  if ((bytes.length - dataOffset) % recordSize !== 0) fail('truncated final record')
  if (recordCount !== undefined && (bytes.length - dataOffset) / recordSize !== recordCount)
    fail('record count mismatch or truncated trace')
  return {version, clock, threads, methods, dataOffset, recordSize, recordCount}
}

interface ThreadState {
  initial: number[]
  stack: number[]
  lastCPU?: number
  lastWall?: number
  builders: CallTreeProfileBuilder[]
}

export function importFromAndroidMethodTrace(
  name: string,
  buffer: ArrayBuffer,
): ProfileGroup | null {
  if (!isAndroidMethodTrace(buffer)) return null
  const header = readHeader(buffer),
    view = new DataView(buffer)
  const states = new Map<number, ThreadState>()
  const records = (
    consume: (thread: number, method: number, action: number, cpu: number, wall: number) => void,
  ) => {
    for (let offset = header.dataOffset; offset < buffer.byteLength; offset += header.recordSize) {
      const thread = header.version === 1 ? view.getUint8(offset) : view.getUint16(offset, true)
      const methodOffset = offset + (header.version === 1 ? 1 : 2)
      const packed = view.getUint32(methodOffset, true),
        action = packed & 3,
        method = (packed & ~3) >>> 0
      const first = view.getUint32(methodOffset + 4, true)
      const cpu = header.clock === 'wall' ? 0 : first
      const wall =
        header.clock === 'dual'
          ? view.getUint32(methodOffset + 8, true)
          : header.clock === 'wall'
            ? first
            : 0
      consume(thread, method, action, cpu, wall)
    }
  }
  // Discover calls already active when tracing started without buffering events.
  // Initial exits arrive from inner to outer; store in that order, then replay
  // the prefix in reverse. The second pass preserves all observed child calls.
  records((thread, method, action, cpu, wall) => {
    if (action === 3) fail('reserved method action 3')
    if (!header.methods.has(method)) fail(`unknown method ID 0x${method.toString(16)}`)
    let state = states.get(thread)
    if (!state) {
      state = {initial: [], stack: [], builders: []}
      states.set(thread, state)
    }
    if (state.lastCPU !== undefined && cpu < state.lastCPU)
      fail('thread CPU timestamps decrease or wrap')
    if (state.lastWall !== undefined && wall < state.lastWall)
      fail('wall timestamps decrease or wrap within a thread')
    state.lastCPU = cpu
    state.lastWall = wall
    if (action === 0) state.stack.push(method)
    else {
      // ART reports one unwind action for each exited method. It is not an
      // instruction to discard arbitrary intervening calls.
      if (!state.stack.length) state.initial.push(method)
      else if (state.stack.pop() !== method) fail('method exit does not match its stack')
    }
  })
  const clocks: ('thread-cpu' | 'wall')[] =
    header.clock === 'dual' ? ['thread-cpu', 'wall'] : [header.clock]
  for (const [thread, state] of states) {
    state.stack = []
    state.builders = clocks.map(clock => {
      const builder = new CallTreeProfileBuilder()
      builder.setName(
        `${header.threads.get(thread) || 'Thread'} (#${thread}) — ${
          clock === 'wall' ? 'wall time' : 'thread CPU time'
        }`,
      )
      builder.setValueFormatter(new TimeFormatter('microseconds'))
      for (let i = state.initial.length - 1; i >= 0; i--)
        builder.enterFrame(header.methods.get(state.initial[i])!, 0)
      return builder
    })
    for (let i = state.initial.length - 1; i >= 0; i--) state.stack.push(state.initial[i])
    state.initial = []
  }
  records((thread, method, action, cpu, wall) => {
    const state = states.get(thread)!
    const update = (enter: boolean, id: number) => {
      for (let i = 0; i < clocks.length; i++) {
        const time = clocks[i] === 'wall' ? wall : cpu
        const frame = header.methods.get(id)!
        if (enter) state.builders[i].enterFrame(frame, time)
        else state.builders[i].leaveFrame(frame, time)
      }
    }
    if (action === 0) {
      state.stack.push(method)
      update(true, method)
    } else {
      const exiting = state.stack.pop()
      if (exiting === undefined) fail('method exit cannot be reconstructed')
      if (exiting !== method) fail('method exit does not match its reconstructed stack')
      update(false, exiting)
    }
  })
  const profiles = []
  for (const state of states.values()) {
    while (state.stack.length) {
      const frame = header.methods.get(state.stack.pop()!)!
      for (let i = 0; i < clocks.length; i++)
        state.builders[i].leaveFrame(frame, clocks[i] === 'wall' ? state.lastWall! : state.lastCPU!)
    }
    for (const builder of state.builders) profiles.push(builder.build())
  }
  return {name, indexToView: 0, profiles}
}
