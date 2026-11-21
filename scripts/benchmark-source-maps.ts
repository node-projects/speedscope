import {SourceLineLookup, importJavaScriptSourceMapSymbolRemapper} from '../src/lib/js-source-map'
import {Frame} from '../src/lib/profile'
async function main() {
  const count = 100000
  const content = Array.from({length: count}, (_, i) => `source_symbol_${i} = 0;`).join('\n')
  const queries = Array.from({length: 5000}, (_, i) => ((i * 7919) % count) + 1)
  let oldChecksum = 0,
    newChecksum = 0
  const oldStart = performance.now()
  for (const number of queries) {
    let start = 0
    for (let line = 1; line < number; line++) start = content.indexOf('\n', start) + 1
    const end = content.indexOf('\n', start)
    oldChecksum += content.slice(start, end < 0 ? content.length : end).length
  }
  const oldMs = performance.now() - oldStart
  const lookup = new SourceLineLookup(),
    newStart = performance.now()
  for (const number of queries) {
    const line = lookup.get('original.ts', content, number)!
    newChecksum += line.end - line.start
  }
  const newMs = performance.now() - newStart
  const map = JSON.stringify({
    version: 3,
    file: 'app.js',
    sources: ['original.ts'],
    sourcesContent: [content],
    names: [],
    mappings: 'AAAA;' + 'AACA;'.repeat(count - 1),
  })
  const remapper = (await importJavaScriptSourceMapSymbolRemapper(map, 'app.js.map'))!
  let mismatches = 0
  const remapStart = performance.now()
  for (let i = 0; i < count; i++) {
    const line = ((i * 7919) % count) + 1
    const result = remapper({name: 'minified', file: 'app.js', line, col: 2} as Frame)
    if (result?.name !== `source_symbol_${line - 1}` || result?.line !== line) mismatches++
  }
  console.log(
    JSON.stringify({
      sourceChars: content.length,
      uniqueLines: count,
      lookupQueries: queries.length,
      oldLookupMs: oldMs,
      indexedLookupMs: newMs,
      sameChecksum: oldChecksum === newChecksum,
      retainedCheckpointBytes: lookup.retainedCheckpointBytes,
      randomFrameRemap100000Ms: performance.now() - remapStart,
      mismatches,
    }),
  )
  if (oldChecksum !== newChecksum || mismatches !== 0)
    throw new Error('Source-line benchmark output differs from its reference')
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
