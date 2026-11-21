import {Profile, ProfileGroup} from '../lib/profile'
import {sourceFileName} from '../lib/profile-context'

import {
  importFromChromeCPUProfile,
  importFromChromeTimeline,
  isChromeTimeline,
  importFromOldV8CPUProfile,
  isChromeTimelineObject,
} from './chrome'
import {importFromStackprof} from './stackprof'
import {importFromInstrumentsDeepCopy, importFromInstrumentsTrace} from './instruments'
import {importFromBGFlameGraph} from './bg-flamegraph'
import {importFromFirefox} from './firefox'
import {importSpeedscopeProfiles} from '../lib/file-format'
import {importFromV8ProfLog} from './v8proflog'
import {importFromLinuxPerf} from './linux-tools-perf'
import {importFromHaskell} from './haskell'
import {isSafariTimeline, importFromSafari} from './safari'
import {ProfileDataSource, TextProfileDataSource, MaybeCompressedDataReader} from './utils'
import {importAsPprofProfile} from './pprof'
import {decodeBase64} from '../lib/utils'
import {importFromChromeHeapProfile} from './v8heapalloc'
import {isTraceEventFormatted, importTraceEvents} from './trace-event'
import {importFromCallgrind} from './callgrind'
import {importFromPapyrus} from './papyrus'
import {importFromPMCStatCallGraph} from './pmcstat-callgraph'
import {importFromJfr, isJfrRecording} from './java-flight-recorder'
import {importFromJSSelfProfiling, isJSSelfProfiling} from './js-self-profiling'
import {importFromJavaThreadDump, isJavaThreadDump} from './java-thread-dump'
import type {ImportProgress} from './trace-worker-protocol'
import {importFromAndroidMethodTrace, isAndroidMethodTrace} from './android-method-trace'
import {importFromOTELProfiles, isOTELProfiles} from './otel-profiles'
import {
  checkJavaThreadDumpZipFileSize,
  importFromJavaThreadDumpZip,
  isJavaThreadDumpZip,
} from './java-thread-dump-zip'

export interface ImportReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImportProgress) => void
}

function checkImportAbort(options: ImportReadOptions) {
  if (options.signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}

export async function importProfileGroupFromText(
  fileName: string,
  contents: string,
): Promise<ProfileGroup | null> {
  return await importProfileGroup(new TextProfileDataSource(fileName, contents))
}

export async function importProfileGroupFromBase64(
  fileName: string,
  b64contents: string,
): Promise<ProfileGroup | null> {
  return await importProfileGroup(
    MaybeCompressedDataReader.fromArrayBuffer(
      fileName,
      decodeBase64(b64contents).buffer as ArrayBuffer,
    ),
  )
}

export async function importProfilesFromFile(
  file: File,
  options: ImportReadOptions = {},
): Promise<ProfileGroup | null> {
  checkImportAbort(options)
  await checkJavaThreadDumpZipFileSize(file, options.signal)
  return importProfileGroup(MaybeCompressedDataReader.fromFile(file), options)
}

export async function importProfilesFromArrayBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  options: ImportReadOptions = {},
): Promise<ProfileGroup | null> {
  checkImportAbort(options)
  return importProfileGroup(MaybeCompressedDataReader.fromArrayBuffer(fileName, buffer), options)
}

async function importProfileGroup(
  dataSource: ProfileDataSource,
  options: ImportReadOptions = {},
): Promise<ProfileGroup | null> {
  checkImportAbort(options)
  const fileName = await dataSource.name()

  checkImportAbort(options)
  const profileGroup = await _importProfileGroup(dataSource, options)
  checkImportAbort(options)
  if (profileGroup) {
    profileGroup.sourceName = sourceFileName(fileName)
    if (!profileGroup.name) {
      profileGroup.name = fileName
    }
    for (let profile of profileGroup.profiles) {
      if (profile && !profile.getName()) {
        profile.setName(fileName)
      }
    }
    return profileGroup
  }
  return null
}

function toGroup(profile: Profile | null): ProfileGroup | null {
  if (!profile) return null
  return {name: profile.getName(), indexToView: 0, profiles: [profile]}
}

async function _importProfileGroup(
  dataSource: ProfileDataSource,
  options: ImportReadOptions,
): Promise<ProfileGroup | null> {
  const fileName = await dataSource.name()

  const buffer = await dataSource.readAsArrayBuffer()
  checkImportAbort(options)

  // Container and binary signatures take precedence over text/protobuf sniffing.
  if (isJavaThreadDumpZip(new Uint8Array(buffer))) {
    console.log('Importing Java thread dump ZIP')
    return importFromJavaThreadDumpZip(buffer, fileName, {
      signal: options.signal,
      onProgress: options.onProgress,
    })
  }
  if (isAndroidMethodTrace(buffer)) {
    console.log('Importing Android method trace')
    return importFromAndroidMethodTrace(fileName, buffer)
  }

  {
    const profile = importAsPprofProfile(buffer)
    if (profile) {
      console.log('Importing as protobuf encoded pprof file')
      return toGroup(profile)
    }
  }

  // Binary JFR recordings can embed complete text thread dumps. Honor the
  // binary signature before decoding or sniffing that embedded text.
  if (isJfrRecording(buffer)) {
    console.log('Importing as Java Flight Recorder profile')
    return importFromJfr(fileName, buffer)
  }

  const contents = await dataSource.readAsText()

  // First pass: Check known file format names to infer the file type
  if (fileName.endsWith('.speedscope.json')) {
    console.log('Importing as speedscope json file')
    return importSpeedscopeProfiles(contents.parseAsJSON())
  } else if (/Trace-\d{8}T\d{6}/.exec(fileName)) {
    console.log('Importing as Chrome Timeline Object')
    return importFromChromeTimeline(contents.parseAsJSON().traceEvents, fileName)
  } else if (fileName.endsWith('.chrome.json') || /Profile-\d{8}T\d{6}/.exec(fileName)) {
    console.log('Importing as Chrome Timeline')
    return importFromChromeTimeline(contents.parseAsJSON(), fileName)
  } else if (fileName.endsWith('.stackprof.json')) {
    console.log('Importing as stackprof profile')
    return toGroup(importFromStackprof(contents.parseAsJSON()))
  } else if (fileName.endsWith('.instruments.txt')) {
    console.log('Importing as Instruments.app deep copy')
    return toGroup(importFromInstrumentsDeepCopy(contents))
  } else if (fileName.endsWith('.linux-perf.txt')) {
    console.log('Importing as output of linux perf script')
    return importFromLinuxPerf(contents)
  } else if (fileName.endsWith('.collapsedstack.txt')) {
    console.log('Importing as collapsed stack format')
    return toGroup(importFromBGFlameGraph(contents))
  } else if (fileName.endsWith('.v8log.json')) {
    console.log('Importing as --prof-process v8 log')
    return toGroup(importFromV8ProfLog(contents.parseAsJSON()))
  } else if (fileName.endsWith('.heapprofile')) {
    console.log('Importing as Chrome Heap Profile')
    return toGroup(importFromChromeHeapProfile(contents.parseAsJSON()))
  } else if (fileName.endsWith('-recording.json')) {
    console.log('Importing as Safari profile')
    return toGroup(importFromSafari(contents.parseAsJSON()))
  } else if (fileName.startsWith('callgrind.')) {
    console.log('Importing as Callgrind profile')
    return importFromCallgrind(contents, fileName)
  } else if (fileName.endsWith('.pmcstat.graph')) {
    console.log('Importing as pmcstat callgraph format')
    return toGroup(importFromPMCStatCallGraph(contents))
  } else if (fileName.endsWith('.jfr')) {
    console.log('Importing as Java Flight Recorder profile')
    return await importFromJfr(fileName, buffer)
  } else if (fileName.endsWith('.jstack')) {
    console.log('Importing as Java thread dump snapshots')
    return importFromJavaThreadDump(contents, fileName)
  }

  // Recognizable text dumps do not need a whole-document JSON parse attempt.
  if (isJavaThreadDump(contents.firstChunk())) {
    console.log('Importing as Java thread dump snapshots')
    return importFromJavaThreadDump(contents, fileName)
  }

  // Second pass: Try to guess what file format it is based on structure
  let parsed: any
  let jsonError: unknown
  try {
    parsed = contents.parseAsJSON()
  } catch (e) {
    jsonError = e
  }
  if (parsed) {
    if (parsed['$schema'] === 'https://www.speedscope.app/file-format-schema.json') {
      console.log('Importing as speedscope json file')
      return importSpeedscopeProfiles(parsed)
    } else if (isOTELProfiles(parsed)) {
      console.log('Importing as OTLP Profiles JSON')
      return importFromOTELProfiles(parsed, fileName, options.signal)
    } else if (parsed['systemHost'] && parsed['systemHost']['name'] == 'Firefox') {
      console.log('Importing as Firefox profile')
      return toGroup(importFromFirefox(parsed))
    } else if (isChromeTimeline(parsed)) {
      console.log('Importing as Chrome Timeline')
      return importFromChromeTimeline(parsed, fileName)
    } else if (isChromeTimelineObject(parsed)) {
      console.log('Importing as Chrome Timeline Object')
      return importFromChromeTimeline(parsed.traceEvents, fileName)
    } else if ('nodes' in parsed && 'samples' in parsed && 'timeDeltas' in parsed) {
      console.log('Importing as Chrome CPU Profile')
      return toGroup(importFromChromeCPUProfile(parsed))
    } else if (isTraceEventFormatted(parsed)) {
      console.log('Importing as Trace Event Format profile')
      return importTraceEvents(parsed)
    } else if ('head' in parsed && 'samples' in parsed && 'timestamps' in parsed) {
      console.log('Importing as Chrome CPU Profile (old format)')
      return toGroup(importFromOldV8CPUProfile(parsed))
    } else if ('mode' in parsed && 'frames' in parsed && 'raw_timestamp_deltas' in parsed) {
      console.log('Importing as stackprof profile')
      return toGroup(importFromStackprof(parsed))
    } else if ('code' in parsed && 'functions' in parsed && 'ticks' in parsed) {
      console.log('Importing as --prof-process v8 log')
      return toGroup(importFromV8ProfLog(parsed))
    } else if ('head' in parsed && 'selfSize' in parsed['head']) {
      console.log('Importing as Chrome Heap Profile')
      return toGroup(importFromChromeHeapProfile(parsed))
    } else if ('rts_arguments' in parsed && 'initial_capabilities' in parsed) {
      console.log('Importing as Haskell GHC JSON Profile')
      return importFromHaskell(parsed)
    } else if (isSafariTimeline(parsed)) {
      console.log('Importing as Safari profile')
      return toGroup(importFromSafari(parsed))
    } else if (isJSSelfProfiling(parsed)) {
      console.log('Importing as JS Self-Profiling')
      return toGroup(importFromJSSelfProfiling(parsed))
    }
  } else {
    // Format is not JSON

    // If the first line is "# callgrind format", it's probably in Callgrind
    // Profile Format.
    if (
      /^# callgrind format/.exec(contents.firstChunk()) ||
      (/^events:/m.exec(contents.firstChunk()) && /^fn=/m.exec(contents.firstChunk()))
    ) {
      console.log('Importing as Callgrind profile')
      return importFromCallgrind(contents, fileName)
    }

    // If the first line contains "Symbol Name", preceded by a tab, it's probably
    // a deep copy from OS X Instruments.app
    if (/^[\w \t\(\)]*\tSymbol Name/.exec(contents.firstChunk())) {
      console.log('Importing as Instruments.app deep copy')
      return toGroup(importFromInstrumentsDeepCopy(contents))
    }

    if (/^(Stack_|Script_|Obj_)\S+ log opened \(PC\)\n/.exec(contents.firstChunk())) {
      console.log('Importing as Papyrus profile')
      return toGroup(importFromPapyrus(contents))
    }

    const fromLinuxPerf = importFromLinuxPerf(contents)
    if (fromLinuxPerf) {
      console.log('Importing from linux perf script output')
      return fromLinuxPerf
    }

    const fromBGFlameGraph = importFromBGFlameGraph(contents)
    if (fromBGFlameGraph) {
      console.log('Importing as collapsed stack format')
      return toGroup(fromBGFlameGraph)
    }

    const fromPMCStatCallGraph = importFromPMCStatCallGraph(contents)
    if (fromPMCStatCallGraph) {
      console.log('Importing as pmcstat callgraph format')
      return toGroup(fromPMCStatCallGraph)
    }
  }

  // Unrecognized format
  if (jsonError && /^\s*[\[{]/.test(contents.firstChunk())) throw jsonError
  return null
}

export async function importFromFileSystemDirectoryEntry(entry: FileSystemDirectoryEntry) {
  const group = await importFromInstrumentsTrace(entry)
  group.sourceName = sourceFileName(entry.name)
  return group
}
