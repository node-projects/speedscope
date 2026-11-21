import {perftools} from './profile.proto.js'
import {FrameInfo, StackListProfileBuilder, Profile, ProfileGroup} from '../lib/profile'
import {lastOf} from '../lib/utils'
import {TimeFormatter, ByteFormatter} from '../lib/value-formatters'
import Long from 'long'

interface SampleType {
  type: string
  unit: string
}

// Find the index of the SampleType which should be used as our default
function getSampleTypeIndex(profile: perftools.profiles.Profile): number {
  const dflt = profile.defaultSampleType
  const sampleTypes = profile.sampleType
  const fallback = sampleTypes.length - 1

  // string_table[0] will always be empty-string, so we can assume dflt === 0 is just the proto
  // empty-value, and means no defaultSampleType was specified.
  if (!dflt || !+dflt) {
    return fallback
  }

  const idx = sampleTypes.findIndex(e => e.type != null && e.type.toString() === dflt.toString())
  if (idx === -1) {
    return fallback
  }
  return idx
}

export function importAsPprofProfile(rawProfile: ArrayBuffer): Profile | null {
  const group = importAsPprofProfileGroup(rawProfile)
  if (!group) return null
  if (group.profiles.length !== 1)
    throw new Error('Signed pprof samples require the contribution-pair importer')
  return group.profiles[0]
}

export function importAsPprofProfileGroup(rawProfile: ArrayBuffer): ProfileGroup | null {
  if (rawProfile.byteLength === 0) return null

  let protoProfile: perftools.profiles.Profile
  try {
    protoProfile = perftools.profiles.Profile.decode(new Uint8Array(rawProfile))
  } catch (e) {
    return null
  }

  function idKey(n: number | Long): string {
    return n.toString()
  }

  function stringVal(key: number | Long): string | null {
    const index = Number(key.toString())
    return Number.isSafeInteger(index) && index >= 0
      ? protoProfile.stringTable[index] || null
      : null
  }

  function sourceLine(value: number | Long | null | undefined): number | undefined {
    if (value == null) return undefined
    const line = Number(value.toString())
    return Number.isSafeInteger(line) && line > 0 ? line : undefined
  }

  const frameInfoByFunctionID = new Map<string, FrameInfo>()

  function frameInfoForFunction(f: perftools.profiles.IFunction): FrameInfo | null {
    const {name, filename, startLine} = f

    const nameString = (name != null && stringVal(name)) || '(unknown)'
    const fileNameString = filename != null ? stringVal(filename) : null
    const line = sourceLine(startLine)

    const key = JSON.stringify([nameString, fileNameString, line])

    const frameInfo: FrameInfo = {
      key,
      name: nameString,
    }

    if (fileNameString != null) {
      frameInfo.file = fileNameString
    }

    if (line != null) {
      frameInfo.line = line
    }

    return frameInfo
  }

  for (let f of protoProfile.function) {
    if (f.id) {
      const frameInfo = frameInfoForFunction(f)
      if (frameInfo != null) {
        frameInfoByFunctionID.set(idKey(f.id), frameInfo)
      }
    }
  }

  function frameInfoForLocation(location: perftools.profiles.ILocation): FrameInfo | null {
    const {line} = location
    if (line == null) return null

    // From a comment on profile.proto:
    //
    //   Multiple line indicates this location has inlined functions,
    //   where the last entry represents the caller into which the
    //   preceding entries were inlined.
    //
    //   E.g., if memcpy() is inlined into printf:
    //      line[0].function_name == "memcpy"
    //      line[1].function_name == "printf"
    //
    // Let's just take the last line then
    const lastLine = lastOf(line)
    if (lastLine == null) return null

    if (lastLine.functionId) {
      const funcFrame = frameInfoByFunctionID.get(idKey(lastLine.functionId))
      if (!funcFrame) return null
      const locationLine = sourceLine(lastLine.line) ?? funcFrame.line
      // Each location owns its source identity; shared function definitions
      // must not be overwritten by another location's line number.
      return {
        ...funcFrame,
        key: JSON.stringify([funcFrame.name, funcFrame.file, locationLine]),
        line: locationLine,
      }
    } else {
      return null
    }
  }

  const frameByLocationID = new Map<string, FrameInfo>()

  for (let l of protoProfile.location) {
    if (l.id != null) {
      const frameInfo = frameInfoForLocation(l)
      if (frameInfo) {
        frameByLocationID.set(idKey(l.id), frameInfo)
      }
    }
  }

  const sampleTypes: SampleType[] = protoProfile.sampleType.map(type => ({
    type: (type.type && stringVal(type.type)) || 'samples',
    unit: (type.unit && stringVal(type.unit)) || 'count',
  }))

  const sampleTypeIndex = getSampleTypeIndex(protoProfile)

  if (sampleTypeIndex < 0 || sampleTypeIndex >= sampleTypes.length) {
    return null
  }

  const sampleType = sampleTypes[sampleTypeIndex]

  let signed = false
  for (const sample of protoProfile.sample) {
    if (!sample.value || sample.value.length <= sampleTypeIndex) return null
    const value = Number(sample.value[sampleTypeIndex].toString())
    if (!Number.isSafeInteger(value))
      throw new Error('pprof sample weight exceeds exact integer range')
    if (value < 0) signed = true
  }

  function builder() {
    const profileBuilder = new StackListProfileBuilder()
    profileBuilder.setChronological(false)

    switch (sampleType.unit) {
      case 'nanoseconds':
      case 'microseconds':
      case 'milliseconds':
      case 'seconds':
        profileBuilder.setValueFormatter(new TimeFormatter(sampleType.unit))
        break

      case 'bytes':
        profileBuilder.setValueFormatter(new ByteFormatter())
        break
    }
    return profileBuilder
  }
  const positive = builder()
  const negative = signed ? builder() : null
  let positiveTotal = 0,
    negativeTotal = 0

  for (let s of protoProfile.sample) {
    const stack = s.locationId ? s.locationId.map(l => frameByLocationID.get(idKey(l))) : []
    stack.reverse()

    if (s.value == null || s.value.length <= sampleTypeIndex) {
      return null
    }

    const value = Number(s.value[sampleTypeIndex].toString())
    if (value < 0) negativeTotal -= value
    else positiveTotal += value
    if (!Number.isSafeInteger(positiveTotal) || !Number.isSafeInteger(negativeTotal))
      throw new Error('pprof total weight exceeds exact integer range')
    const target = value < 0 ? negative! : positive
    target.appendSampleWithWeight(stack.filter(f => f != null) as FrameInfo[], Math.abs(value))
  }

  if (!negative) return {name: '', indexToView: 0, profiles: [positive.build()]}
  negative.setName(`${sampleType.type} — Negative contributions (magnitude; subtract)`)
  positive.setName(`${sampleType.type} — Positive contributions`)
  return {
    name: `pprof ${sampleType.type} — signed contributions (positive minus negative)`,
    indexToView: 0,
    profiles: [negative.build(), positive.build()],
  }
}
