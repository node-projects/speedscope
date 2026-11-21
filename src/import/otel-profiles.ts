import Long from 'long'
import {FrameInfo, ProfileGroup, StackListProfileBuilder} from '../lib/profile'
import {ByteFormatter, RawValueFormatter, TimeFormatter} from '../lib/value-formatters'

// Current OTLP v1development dictionary/stack-table JSON, development version 1.
// See docs/OTEL_PROFILES.md for the pinned schema and deliberately aggregate semantics.
export function isOTELProfiles(value: any): boolean {
  return value != null && typeof value === 'object' && 'resourceProfiles' in value
}

function fail(message: string): never {
  throw new Error(`OTLP Profiles: ${message}`)
}
function object(value: any, label: string): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${label}`)
  return value
}
function array(value: any, label: string): any[] {
  if (!Array.isArray(value)) fail(`invalid ${label}`)
  if (value.length > 1_000_000) fail(`${label} exceeds 1,000,000 entries`)
  if (value.some(entry => entry == null)) fail(`${label} contains a null entry`)
  return value
}
function decimal(value: any, label: string, signed = false): string {
  if (value == null) return '0'
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    fail(`${label} requires a safe integer or exact decimal string`)
  }
  const text = String(value)
  if (!/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(text)) fail(`invalid ${label}`)
  const negative = text[0] === '-'
  const digits = negative ? text.slice(1) : text
  const max = signed
    ? negative
      ? '9223372036854775808'
      : '9223372036854775807'
    : '18446744073709551615'
  if (
    (!signed && negative) ||
    digits.length > max.length ||
    (digits.length === max.length && digits > max)
  ) {
    fail(`${label} out of range`)
  }
  return text
}
function safe(value: any, label: string): number {
  const text = decimal(value, label, true)
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n < 0) fail(`${label} must be a nonnegative safe integer`)
  return n
}

export async function importFromOTELProfiles(
  input: any,
  fileName: string,
  signal?: AbortSignal,
): Promise<ProfileGroup> {
  object(input, 'document')
  if (input.developmentVersion != null && String(input.developmentVersion) !== '1') {
    fail('unsupported developmentVersion (only 1 is supported)')
  }
  const dictionary = object(input.dictionary, 'shared dictionary (legacy layouts are unsupported)')
  const names = [
    'stringTable',
    'mappingTable',
    'locationTable',
    'functionTable',
    'linkTable',
    'attributeTable',
    'stackTable',
  ]
  let entries = 0
  // Bound zero-value validation independently of the remaining dictionary.
  function zero(value: any, depth = 0): boolean {
    if (depth > 8) return false
    if (value == null || value === '' || value === 0 || value === '0' || value === false)
      return true
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.keys(value).every(k => zero(value[k], depth + 1))
    return false
  }
  for (const name of names) {
    const table = array(dictionary[name], name)
    entries += table.length
    if (entries > 1_000_000) fail('dictionary exceeds 1,000,000 entries')
    // Link IDs use hex encoding in OTLP JSON; all-zero IDs are also default values.
    if (name !== 'stringTable') object(table[0], `${name}[0] zero value`)
    const sentinel = name === 'linkTable' ? {...table[0]} : table[0]
    if (name === 'linkTable') {
      for (const key of ['traceId', 'spanId']) {
        if (typeof sentinel[key] === 'string' && /^0+$/.test(sentinel[key])) sentinel[key] = ''
      }
    }
    if (!table.length || !zero(sentinel) || (name === 'stringTable' && table[0] !== '')) {
      fail(`${name}[0] must be the zero value`)
    }
  }
  function ref(table: string, index: any): any {
    const n = safe(index, `${table} index`)
    if (n > 2147483647 || n >= dictionary[table].length) fail(`missing ${table} index ${n}`)
    return dictionary[table][n]
  }
  function str(index: any): string {
    const value = ref('stringTable', index)
    if (typeof value !== 'string') fail('invalid stringTable entry')
    return value
  }
  function attrs(values: any, indirect: boolean): Map<string, string> {
    const result = new Map<string, string>()
    const list = array(values ?? [], 'attributes')
    if (list.length > 4096) fail('attribute set exceeds 4096 entries')
    for (const entry of list) {
      const item = object(indirect ? ref('attributeTable', entry) : entry, 'attribute')
      const key = item.key || str(item.keyStrindex)
      if (item.key && item.keyStrindex) fail('attribute has both key and keyStrindex')
      if (result.has(key)) fail(`duplicate attribute key ${key}`)
      const value = object(item.value || {}, 'attribute value')
      const fields = Object.keys(value)
      if (fields.length > 1) fail('attribute value must have a single value field')
      let text = ''
      if ('stringValue' in value) text = value.stringValue
      else if ('stringValueStrindex' in value) text = str(value.stringValueStrindex)
      else if ('intValue' in value) text = decimal(value.intValue, 'attribute integer', true)
      else if ('boolValue' in value) {
        if (typeof value.boolValue !== 'boolean') fail('invalid boolean attribute')
        text = String(value.boolValue)
      } else if (
        ['thread.id', 'thread.name', 'service.name', 'process.executable.name'].includes(key)
      ) {
        fail(`unsupported identity attribute value for ${key}`)
      }
      // Complex arbitrary attributes are not used as thread or resource identities.
      if (typeof text !== 'string' || text.length > 4096)
        fail('invalid or oversized attribute label')
      result.set(key, text)
      if (indirect) str(item.unitStrindex)
    }
    return result
  }
  const result: ProfileGroup = {name: fileName, indexToView: 0, profiles: []}
  let work = 0
  function checkpoint(): boolean {
    if (++work > 10_000_000) fail('expanded input exceeds 10,000,000 operations')
    if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
    return (work & 4095) === 0
  }
  let profileNumber = 0
  for (const resource of array(input.resourceProfiles, 'resourceProfiles')) {
    if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
    const resourceAttrs = attrs(resource.resource?.attributes, false)
    for (const scope of array(resource.scopeProfiles ?? [], 'scopeProfiles')) {
      if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
      attrs(scope.scope?.attributes, false)
      for (const profile of array(scope.profiles ?? [], 'profiles')) {
        if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
        ++profileNumber
        if (
          profile.sample ||
          Array.isArray(profile.sampleType) ||
          profile.stringTable ||
          profile.locationTable
        ) {
          fail('legacy profile layout is unsupported')
        }
        const type = object(profile.sampleType, 'sampleType')
        const metric = str(type.typeStrindex)
        const unit = str(type.unitStrindex)
        let formatter
        const times: {[key: string]: 'nanoseconds' | 'microseconds' | 'milliseconds' | 'seconds'} =
          {
            ns: 'nanoseconds',
            nanoseconds: 'nanoseconds',
            us: 'microseconds',
            µs: 'microseconds',
            μs: 'microseconds',
            microseconds: 'microseconds',
            ms: 'milliseconds',
            milliseconds: 'milliseconds',
            s: 'seconds',
            seconds: 'seconds',
          }
        if (Object.prototype.hasOwnProperty.call(times, unit))
          formatter = new TimeFormatter(times[unit])
        else if (unit === 'bytes' || unit === 'By') formatter = new ByteFormatter()
        else if (['', '1', 'count', '{count}'].includes(unit)) formatter = new RawValueFormatter()
        else fail(`unsupported sample unit ${unit}`)
        if (profile.periodType) {
          str(profile.periodType.typeStrindex)
          str(profile.periodType.unitStrindex)
        }
        decimal(profile.period, 'period', true) // Informational: values are already weights.
        const start = Long.fromString(decimal(profile.timeUnixNano, 'timeUnixNano'), true)
        const duration = Long.fromString(decimal(profile.durationNano, 'durationNano'), true)
        const end = start.add(duration)
        if (end.lessThan(start)) fail('profile time range overflows uint64')
        const inherited = attrs(profile.attributeIndices, true)
        const builders = new Map<string, StackListProfileBuilder>()
        const totals = new Map<string, number>()
        for (const sample of array(profile.samples ?? [], 'samples')) {
          if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
          ref('linkTable', sample.linkIndex)
          const values = array(sample.values ?? [], 'sample values')
          const timestamps = array(sample.timestampsUnixNano ?? [], 'sample timestamps')
          if (!values.length && !timestamps.length) fail('sample requires values or timestamps')
          if (values.length && timestamps.length && values.length !== timestamps.length)
            fail('sample values/timestamps length mismatch')
          let weight = values.length ? 0 : timestamps.length
          for (const value of values) {
            if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
            weight += safe(value, 'sample weight')
            if (!Number.isSafeInteger(weight))
              fail('sample weight total exceeds safe integer range')
          }
          for (const timestamp of timestamps) {
            if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
            const time = Long.fromString(decimal(timestamp, 'sample timestamp'), true)
            if (!duration.isZero() && (time.lessThan(start) || !time.lessThan(end)))
              fail('sample timestamp outside profile range')
          }
          const sampleAttrs = attrs(sample.attributeIndices, true)
          const threadId = sampleAttrs.get('thread.id') ?? inherited.get('thread.id') ?? ''
          const threadName = sampleAttrs.get('thread.name') ?? inherited.get('thread.name') ?? ''
          const threadKey = JSON.stringify([threadId, threadName])
          let builder = builders.get(threadKey)
          if (!builder) {
            if (result.profiles.length + builders.size >= 4096) fail('output exceeds 4096 profiles')
            builder = new StackListProfileBuilder()
            builder.setValueFormatter(formatter)
            builder.setChronological(false)
            builder.setName(
              [
                resourceAttrs.get('service.name') ||
                  resourceAttrs.get('process.executable.name') ||
                  'OTLP',
                scope.scope?.name,
                `${metric || 'samples'} #${profileNumber}`,
                threadName,
                threadId ? `thread ${threadId}` : '',
              ]
                .filter(Boolean)
                .join(' / '),
            )
            builders.set(threadKey, builder)
          }
          const stack: FrameInfo[] = []
          const locations = array(
            object(ref('stackTable', sample.stackIndex), 'stack').locationIndices ?? [],
            'locationIndices',
          )
          if (locations.length > 100_000) fail('stack exceeds 100,000 frames')
          for (let i = locations.length - 1; i >= 0; --i) {
            if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
            const location = object(ref('locationTable', locations[i]), 'location')
            const mapping = object(ref('mappingTable', location.mappingIndex), 'mapping')
            const binary = str(mapping.filenameStrindex)
            const address = Long.fromString(decimal(location.address, 'address'), true).toString(16)
            const lines = array(location.lines ?? [], 'lines')
            if (!lines.length) {
              const name = `${binary || '(unknown)'} 0x${address}`
              stack.push({key: JSON.stringify([name, binary]), name, file: binary || undefined})
            }
            for (let j = lines.length - 1; j >= 0; --j) {
              if (checkpoint()) await new Promise(resolve => setTimeout(resolve, 0))
              const line = lines[j]
              const fn = object(ref('functionTable', line.functionIndex), 'function')
              const name = str(fn.nameStrindex) || str(fn.systemNameStrindex) || '(unknown)'
              const file = str(fn.filenameStrindex) || binary || undefined
              const row =
                safe(line.line, 'source line') ||
                safe(fn.startLine, 'function start line') ||
                undefined
              const col = safe(line.column, 'source column') || undefined
              stack.push({key: JSON.stringify([name, file, row, col]), name, file, line: row, col})
              if (stack.length > 100_000) fail('stack exceeds 100,000 frames')
            }
          }
          const total = (totals.get(threadKey) || 0) + weight
          if (!Number.isSafeInteger(total)) fail('profile total exceeds safe integer range')
          totals.set(threadKey, total)
          builder.appendSampleWithWeight(stack, weight)
        }
        for (const builder of builders.values()) result.profiles.push(builder.build())
      }
    }
  }
  return result
}
