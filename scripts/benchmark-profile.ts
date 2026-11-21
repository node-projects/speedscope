import fs from 'fs'
import path from 'path'
import {Readable} from 'stream'
import {importProfilesFromArrayBuffer} from '../src/import'
import {importDurationTraceStream} from '../src/import/streaming-trace'
import {importTextProfileStream, textProfileKind} from '../src/import/streaming-text-profile'
import {
  combineProfiles,
  invertProfile,
  groupProfileByFile,
} from '../src/lib/profile-transformations'
import {exportProfileGroup} from '../src/lib/file-format'
import {exportProfileGroupToBlob} from '../src/lib/profile-export'
import {Flamechart} from '../src/lib/flamechart'
import {ProfileSearchResults, FlamechartSearchResults} from '../src/lib/profile-search'
import {buildMultiTrackLayout, collectTrackTiles} from '../src/lib/multi-track-layout'

async function main() {
  const [filename, action = 'all', query = ' '] = process.argv.slice(2)
  if (
    ![
      'all',
      'import',
      'stream-import',
      'text-stream-import',
      'text-stream-main-import',
      'stream-search',
      'stream-tracks',
      'export',
      'legacy-export',
    ].includes(action)
  )
    throw new Error(`Unknown action: ${action}`)
  const start = Date.now()
  let group
  if (
    action === 'stream-import' ||
    action === 'stream-search' ||
    action === 'stream-tracks' ||
    action.startsWith('text-stream-')
  ) {
    const header = new Uint8Array(2)
    const fd = fs.openSync(filename, 'r')
    try {
      fs.readSync(fd, header)
    } finally {
      fs.closeSync(fd)
    }
    let stream: ReadableStream<Uint8Array<ArrayBuffer>> = (Readable as any).toWeb(
      fs.createReadStream(filename, {highWaterMark: 64 * 1024}),
    )
    if (header[0] === 0x1f && header[1] === 0x8b)
      stream = stream.pipeThrough(new DecompressionStream('gzip'))
    if (action.startsWith('text-stream-')) {
      const kind = textProfileKind(path.basename(filename))
      if (!kind) throw new Error('Use a supported folded/perf text filename for text-stream-import')
      group = await importTextProfileStream(stream, path.basename(filename), kind, {
        yieldToMainThread: action === 'text-stream-main-import',
      })
    } else group = await importDurationTraceStream(stream, path.basename(filename))
  } else {
    const input = fs.readFileSync(filename)
    group = await importProfilesFromArrayBuffer(
      path.basename(filename),
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
    )
  }
  if (!group) throw new Error('Unrecognized profile')
  console.log(
    JSON.stringify({
      action: action.startsWith('text-stream-')
        ? action
        : action === 'stream-import' || action === 'stream-search' || action === 'stream-tracks'
          ? 'stream-import'
          : 'import',
      ms: Date.now() - start,
      profiles: group.profiles.length,
      totals: group.profiles.map(p => p.getTotalWeight()),
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  )
  if (action === 'import' || action === 'stream-import' || action.startsWith('text-stream-')) return
  ;(globalThis as any).gc?.()
  if (action === 'stream-tracks') {
    const track = buildMultiTrackLayout(group.profiles).groups[0]?.tracks[0]
    if (!track || !(track.profile.getTotalWeight() > 0))
      throw new Error('Tracks benchmark needs a chronological profile with an explicit clock')
    const heapBefore = process.memoryUsage().heapUsed
    const indexStart = performance.now()
    const rangeIndex = await track.profile.createCallEventRangeIndex()
    const indexMs = performance.now() - indexStart
    ;(globalThis as any).gc?.()
    const retainedIndexHeapMiB = (process.memoryUsage().heapUsed - heapBefore) / 1048576
    const duration = track.profile.getTotalWeight()
    let fullEvents = 0,
      indexedEvents = 0
    const fullMs: number[] = [],
      indexedMs: number[] = []
    for (let index = 0; index < 10; index++) {
      const viewport = {
        left: track.offset + duration * (0.9 + index * 0.001),
        width: duration * 0.005,
      }
      const fullStart = performance.now()
      const full = await collectTrackTiles(track, viewport)
      fullMs.push(performance.now() - fullStart)
      const indexedStart = performance.now()
      const indexed = await collectTrackTiles(track, viewport, {rangeIndex})
      indexedMs.push(performance.now() - indexedStart)
      if (
        full.omitted !== indexed.omitted ||
        full.deeper !== indexed.deeper ||
        full.tiles.length !== indexed.tiles.length ||
        full.tiles.some((tile, position) => {
          const other = indexed.tiles[position]
          return (
            tile.node !== other.node ||
            tile.depth !== other.depth ||
            tile.start !== other.start ||
            tile.end !== other.end
          )
        })
      )
        throw new Error(`Indexed Tracks geometry differs in viewport ${index}`)
      fullEvents += full.eventsVisited
      indexedEvents += indexed.eventsVisited
    }
    console.log(
      JSON.stringify({
        action,
        indexMs,
        checkpointCount: rangeIndex.checkpointCount,
        indexBytes: rangeIndex.byteLength,
        retainedIndexHeapMiB,
        fullMs,
        indexedMs,
        fullEvents,
        indexedEvents,
        geometryEqual: true,
      }),
    )
    return
  }
  if (action === 'stream-search') {
    const profile = group.profiles[0]
    const chart = new Flamechart({
      getTotalWeight: () => profile.getTotalWeight(),
      formatValue: value => profile.formatValue(value),
      forEachCall: profile.forEachCall.bind(profile),
      getColorBucketForFrame: () => 0,
    })
    ;(globalThis as any).gc?.()
    const before = process.memoryUsage().heapUsed
    const timer = Date.now()
    const results = new FlamechartSearchResults(chart, new ProfileSearchResults(profile, query))
    const count = results.count()
    for (let i = 0; i < Math.min(10, count); i++) results.at(i)
    const ms = Date.now() - timer
    ;(globalThis as any).gc?.()
    const retainedSearchMB = (process.memoryUsage().heapUsed - before) / 1048576
    console.log(
      JSON.stringify({
        action,
        ms,
        matches: results.count(),
        limited: results.isTruncated(),
        retainedSearchMB,
      }),
    )
    return
  }
  if (action === 'all') {
    let timer = Date.now()
    const combined = combineProfiles(group.profiles)
    console.log(
      JSON.stringify({action: 'combine', ms: Date.now() - timer, total: combined.getTotalWeight()}),
    )
    timer = Date.now()
    const inverted = invertProfile(combined)
    console.log(
      JSON.stringify({action: 'invert', ms: Date.now() - timer, total: inverted.getTotalWeight()}),
    )
    timer = Date.now()
    const grouped = groupProfileByFile(combined)
    console.log(
      JSON.stringify({action: 'file', ms: Date.now() - timer, total: grouped.getTotalWeight()}),
    )
    return
  }
  const before = process.memoryUsage()
  let maxHeap = before.heapUsed
  const sample = () => {
    maxHeap = Math.max(maxHeap, process.memoryUsage().heapUsed)
  }
  const timer = Date.now()
  let blob: Blob
  let yields = 0
  if (action === 'legacy-export') {
    const file = exportProfileGroup(group)
    const text = JSON.stringify(file)
    sample()
    blob = new Blob([text])
    sample()
  } else {
    blob = await exportProfileGroupToBlob(group, {
      onProgress: () => {
        yields++
        sample()
      },
    })
  }
  console.log(
    JSON.stringify({
      action,
      ms: Date.now() - timer,
      bytes: blob.size,
      progressUpdates: yields,
      baselineHeapMB: Math.round(before.heapUsed / 1048576),
      sampledPeakHeapMB: Math.round(maxHeap / 1048576),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  )
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
