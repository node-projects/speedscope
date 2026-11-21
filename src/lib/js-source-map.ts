// This file contains code to allow profiles to be remapped by JavaScript source maps.
//
// As of writing, this is using an out-of-date version of source-map, because the
// source-map library migrated to using web-assembly. This requires loading the
// web-assembly ball. The easiest way to do this is to load it from a third-party
// URL, but I want speedscope to work standalone offline. This means that the remaining
// options require some way of having a local URL that corresponds the .wasm file.
//
// This is rarely used, so let's load it async to avoid bloating the initial
// bundle.
//
// TODO(jlfwong): Revisit using the newer, wasm-based version of source-map now
// that we're using esbuild for bundling.
import type {MappingItem, RawSourceMap, SourceMapConsumer} from 'source-map'
const sourceMapModule = import('source-map')

import {Frame, SymbolRemapper} from './profile'
import {findIndexBisect} from './utils'

const DEBUG = false

export interface SourceMapRemapOptions {
  // An explicitly selected generated file overrides the map's optional file
  // field and filename heuristic (linked maps need not share a basename).
  generatedFile?: string
  maxMappings?: number
  sourceMapURL?: string
  signal?: AbortSignal
}

export const SOURCE_LINE_CACHE_LIMITS = Object.freeze({sources: 16, checkpoints: 4096, stride: 64})
interface LineOffsets {
  start: number
  end: number
}
interface SourceLines {
  content: string
  checkpoints: Uint32Array
  used: number
  stride: number
  lines: number
  last?: {number: number; offsets: LineOffsets}
}

// Sparse offsets only, never a split line array or copied source text. Indexes
// compact to a coarser stride if a local source exceeds the checkpoint budget.
// Sixteen bounded Uint32 arrays retain at most 256 KiB in total.
export class SourceLineLookup {
  private sources = new Map<string, SourceLines>()

  get retainedCheckpointBytes() {
    let bytes = 0
    for (const source of this.sources.values()) bytes += source.checkpoints.byteLength
    return bytes
  }

  get(source: string, content: string, number: number): LineOffsets | undefined {
    if (!Number.isSafeInteger(number) || number < 1) return undefined
    let index = this.sources.get(source)
    if (!index || index.content !== content) {
      if (index) this.sources.delete(source)
      if (this.sources.size === SOURCE_LINE_CACHE_LIMITS.sources)
        this.sources.delete(this.sources.keys().next().value!)
      index = {
        content,
        checkpoints: new Uint32Array(64),
        used: 1,
        stride: SOURCE_LINE_CACHE_LIMITS.stride,
        lines: 1,
      }
      let offset = 0,
        newline: number
      while ((newline = content.indexOf('\n', offset)) !== -1) {
        offset = newline + 1
        index.lines++
        if ((index.lines - 1) % index.stride !== 0) continue
        if (index.used === SOURCE_LINE_CACHE_LIMITS.checkpoints) {
          for (let i = 0; i < index.used / 2; i++) index.checkpoints[i] = index.checkpoints[i * 2]
          index.used /= 2
          index.stride *= 2
        }
        if ((index.lines - 1) % index.stride !== 0) continue
        if (index.used === index.checkpoints.length) {
          const larger = new Uint32Array(
            Math.min(index.checkpoints.length * 2, SOURCE_LINE_CACHE_LIMITS.checkpoints),
          )
          larger.set(index.checkpoints)
          index.checkpoints = larger
        }
        index.checkpoints[index.used++] = offset
      }
      this.sources.set(source, index)
    } else {
      // Touch LRU without retaining a second content/string cache.
      this.sources.delete(source)
      this.sources.set(source, index)
    }
    if (number > index.lines) return undefined
    if (index.last?.number === number) return index.last.offsets
    const checkpoint = Math.floor((number - 1) / index.stride)
    let start = index.checkpoints[checkpoint]
    for (let line = checkpoint * index.stride + 1; line < number; line++)
      start = content.indexOf('\n', start) + 1
    const newline = content.indexOf('\n', start)
    const offsets = {start, end: newline < 0 ? content.length : newline}
    index.last = {number, offsets}
    return offsets
  }
}

function canonicalHTTPFile(file: string | undefined): string | null {
  if (file == null) return null
  try {
    const url = new URL(file)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

// Count encoded segments before SourceMapConsumer expands its decoded arrays,
// including nested index maps. Do not split the mappings string into an array.
function checkMappingBudget(contents: unknown, maximum: number): void {
  const pending = [{value: contents, depth: 0}]
  let segments = 0,
    sections = 0
  while (pending.length) {
    const {value, depth} = pending.pop()!
    if (value == null || typeof value !== 'object') continue
    const map = value as {mappings?: unknown; sections?: unknown}
    if (typeof map.mappings === 'string') {
      let segmentLength = 0
      for (let i = 0; i < map.mappings.length; i++) {
        const char = map.mappings[i]
        if (char === ',' || char === ';') segmentLength = 0
        else {
          if (segmentLength++ === 0 && ++segments > maximum)
            throw new Error(`Source map exceeds ${maximum.toLocaleString('en-US')} mappings`)
          if (segmentLength > 128) throw new Error('Source map contains an oversized VLQ segment')
        }
      }
    }
    if (Array.isArray(map.sections)) {
      if (depth >= 32) throw new Error('Source map index nesting exceeds 32 levels')
      for (const section of map.sections) {
        if (++sections > 1000) throw new Error('Source map exceeds 1,000 indexed sections')
        if (section && typeof section === 'object')
          pending.push({value: section.map, depth: depth + 1})
      }
    }
  }
}

export async function importJavaScriptSourceMapSymbolRemapper(
  contentsString: string,
  sourceMapFileName: string,
  options: SourceMapRemapOptions = {},
): Promise<SymbolRemapper | null> {
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Source-map load cancelled', 'AbortError')
  }
  checkAbort()
  const sourceMap = await sourceMapModule
  checkAbort()

  let consumer: SourceMapConsumer | null = null
  let contents: RawSourceMap | null = null

  try {
    contents = JSON.parse(contentsString)
  } catch {
    return null
  }
  if (
    options.maxMappings !== undefined &&
    (!Number.isSafeInteger(options.maxMappings) || options.maxMappings < 1)
  )
    throw new Error('Invalid source-map mapping limit')
  if (options.maxMappings !== undefined) checkMappingBudget(contents, options.maxMappings)
  checkAbort()
  try {
    // source-map 0.6.1 accepts this public second argument, although its old
    // bundled declarations omit it. It resolves relative sources against the
    // fetched map URL without fetching any original source files.
    const Consumer = sourceMap.default.SourceMapConsumer as unknown as {
      new (raw: RawSourceMap, mapURL?: string): SourceMapConsumer
    }
    consumer = new Consumer(contents!, options.sourceMapURL)
  } catch (e) {
    return null
  }

  const mappingItems: MappingItem[] = []
  consumer.eachMapping(
    function (m: MappingItem) {
      if (mappingItems.length % 512 === 0) checkAbort()
      if (options.maxMappings !== undefined && mappingItems.length >= options.maxMappings)
        throw new Error(
          `Source map exceeds ${options.maxMappings.toLocaleString('en-US')} mappings`,
        )
      // The sourcemap library uses 1-based line numbers, and 0-based column
      // numbers. speedscope uses 1-based line-numbers, and 1-based column
      // numbers for its in-memory representation, so we'll normalize that
      // here too.
      mappingItems.push({
        ...m,
        generatedColumn: m.generatedColumn + 1,
        originalColumn: m.originalColumn + 1,
      })
    },
    {},

    // We're going to binary search through these later, so make sure they're
    // sorted by their order in the generated file.
    sourceMap.default.SourceMapConsumer.GENERATED_ORDER,
  )

  if (!mappingItems.length) return null
  checkAbort()

  const sourceMapFileNameWithoutExt = sourceMapFileName.replace(/\\/g, '/').replace(/\.[^/]*$/, '')
  const explicitGeneratedFile = canonicalHTTPFile(options.generatedFile)
  const sourceLines = new SourceLineLookup()

  return (frame: Frame) => {
    const frameFile = frame.file?.replace(/\\/g, '/')
    let fileMatches = false
    if (options.generatedFile !== undefined) {
      fileMatches =
        explicitGeneratedFile !== null && canonicalHTTPFile(frameFile) === explicitGeneratedFile
    } else if (contents?.file && contents.file.replace(/\\/g, '/') === frameFile) {
      fileMatches = true
    } else if (
      ('/' + frameFile?.replace(/\.[^/]*$/, '')).endsWith('/' + sourceMapFileNameWithoutExt)
    ) {
      fileMatches = true
    }
    if (!fileMatches) {
      // The source-map doesn't apply to the file this frame is defined in.
      return null
    }

    if (frame.line == null || frame.col == null) {
      // If we don't have a line & column number for the frame, we can't
      // remap it.
      return null
    }

    // If we got here, then we hopefully have an remapping.
    //
    // Ideally, we'd look up a symbol whose generatedLine & generatedColumn
    // match what we have in our profile, but unfortunately browsers don't do
    // this.
    //
    // Browsers set the column number for a function to the index of the
    // opening paren for the argument list, rather than the beginning of the
    // index of the name.
    //
    // function alpha() { ... }
    //               ^
    //
    // const beta = function() { ... }
    //                      ^
    //
    // const gamma = () => { ... }
    //               ^
    //
    // Since we don't have the source code being profiled, we unfortunately
    // can't normalize this to set the column to the first character of the
    // actual name.
    //
    // To work around this limitation, we'll search backwards from the first
    // mapping whose generatedLine & generatedColumn are beyond the location
    // in the profile.
    let mappingIndex = findIndexBisect(mappingItems, m => {
      if (m.generatedLine > frame.line!) return true
      if (m.generatedLine < frame.line!) return false
      if (m.generatedColumn >= frame.col!) return true
      return false
    })

    if (mappingIndex === -1) {
      // There are no symbols following the given profile frame symbol, so try
      // to apply the very last mapping.
      mappingIndex = mappingItems.length - 1
    } else if (mappingIndex === 0) {
      // An exact first mapping is usable even though there is no preceding
      // symbol. Keep the existing opening-paren heuristic for later mappings.
      const first = mappingItems[0]
      if (first.generatedLine !== frame.line || first.generatedColumn !== frame.col) return null
    } else {
      mappingIndex--
    }

    const sourceMapItem = mappingItems[mappingIndex]
    const remappedFrameInfo: {name?: string; file?: string; line?: number; col?: number} = {}

    if (sourceMapItem.name != null) {
      remappedFrameInfo.name = sourceMapItem.name
    } else if (sourceMapItem.source != null) {
      // HACK: If the item name isn't specified, but the source is present, then
      // we're going to try to guess what the name is by using the originalLine
      // and originalColumn.

      // The second argument here is "returnNullOnMissing". Without this, it
      // throws instead of returning null.
      const content = consumer?.sourceContentFor(sourceMapItem.source, true)
      if (content) {
        const line = sourceLines.get(sourceMapItem.source, content, sourceMapItem.originalLine)
        if (line && line.end > line.start) {
          // It's possible this source map entry will contain stuff other than
          // the name, so let's only consider word-ish characters that are part
          // of the prefix.
          const identifierMatch = /\w+/.exec(
            content.slice(line.start + sourceMapItem.originalColumn - 1, line.end),
          )
          if (identifierMatch) {
            remappedFrameInfo.name = identifierMatch[0]
          }
        }
      }
    }

    switch (remappedFrameInfo.name) {
      case 'constructor': {
        // If the name was remapped to "constructor", then let's use the
        // original name, since "constructor" isn't very helpful.
        //
        // TODO(jlfwong): Search backwards for the class keyword and see if we
        // can guess the right name.
        remappedFrameInfo.name = frame.name + ' constructor'
        break
      }

      case 'function': {
        // If the name is just "function", it probably means we either messed up
        // the remapping, or that we matched an anonymous function. In either
        // case, this isn't helpful, so put this back.
        remappedFrameInfo.name = frame.name
        break
      }

      case 'const':
      case 'export': {
        // If we got this, we probably just did a bad job leveraging the hack
        // looking through the source code. Let's fall-back to whatever the
        // original name was.
        remappedFrameInfo.name = frame.name
        break
      }
    }

    if (remappedFrameInfo.name && frame.name.includes(remappedFrameInfo.name)) {
      // If the remapped name is a substring of the original name, the original
      // name probably contains more useful information. In that case, just use
      // the original name instead.
      //
      // This can happen, for example, when remapping method names. If a
      // call stack says the symbol name is "n.zap" and we remapped it to a
      // function just called "zap", we might as well use the original name
      // instead.
      remappedFrameInfo.name = frame.name
    }

    if (sourceMapItem.source != null) {
      remappedFrameInfo.file = sourceMapItem.source
      remappedFrameInfo.line = sourceMapItem.originalLine
      remappedFrameInfo.col = sourceMapItem.originalColumn
    }

    if (DEBUG) {
      console.groupCollapsed(`Remapping "${frame.name}" -> "${remappedFrameInfo.name}"`)
      console.log('before', {...frame})
      console.log('item @ index', sourceMapItem)
      console.log('item @ index + 1', mappingItems[mappingIndex + 1])
      console.log('after', remappedFrameInfo)
      console.groupEnd()
    }

    return remappedFrameInfo
  }
}
