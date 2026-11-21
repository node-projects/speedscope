import * as fs from 'fs'
import * as path from 'path'
import {importProfilesFromArrayBuffer} from '../import'
import {
  importJavaScriptSourceMapSymbolRemapper,
  SourceLineLookup,
  SOURCE_LINE_CACHE_LIMITS,
} from './js-source-map'
import {Frame} from './profile'
import {importFromV8ProfLog} from '../import/v8proflog'
import {KeyedSet} from './utils'

test('a valid source map with no mappings is ignored', async () => {
  expect(
    await importJavaScriptSourceMapSymbolRemapper(
      JSON.stringify({version: 3, sources: [], names: [], mappings: ''}),
      'empty.js.map',
    ),
  ).toBeNull()
})

test('unnamed mappings infer symbols without splitting the whole embedded source for each frame', async () => {
  const content = 'originalName = 1;\n' + '// more source\n'.repeat(10000)
  const remapper = await importJavaScriptSourceMapSymbolRemapper(
    JSON.stringify({
      version: 3,
      sources: ['original.ts'],
      sourcesContent: [content],
      names: [],
      mappings: 'AAAA',
    }),
    'app.js.map',
  )
  expect(remapper).not.toBeNull()
  const frame = Frame.getOrInsert(new KeyedSet<Frame>(), {
    key: 1,
    name: 'minified',
    file: 'app.js',
    line: 1,
    col: 1,
  })
  const split = String.prototype.split
  const guard = jest.spyOn(String.prototype, 'split')
  guard.mockImplementation(function (this: string, separator: any, limit?: number) {
    if (String(this) === content) throw new Error('Do not split the whole embedded source')
    return split.call(this, separator, limit)
  })
  try {
    expect(remapper!(frame)).toMatchObject({
      name: 'originalName',
      file: 'original.ts',
      line: 1,
      col: 1,
    })
    expect(remapper!(frame)).toMatchObject({name: 'originalName'})
  } finally {
    guard.mockRestore()
  }
})

test('many unique random-order original lines do not repeatedly scan embedded source prefixes', async () => {
  const count = 20000
  const content = Array.from({length: count}, (_, i) => `symbol_${i + 1} = ${i};`).join('\n')
  const remapper = (await importJavaScriptSourceMapSymbolRemapper(
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['original.ts'],
      sourcesContent: [content],
      names: [],
      mappings: 'AAAA;' + 'AACA;'.repeat(count - 1),
    }),
    'app.js.map',
  ))!
  const original = String.prototype.indexOf
  let newlineScans = 0
  // Count work without retaining a Jest call record per scanned newline.
  String.prototype.indexOf = function (this: string, needle: string, offset?: number) {
    if (needle === '\n' && String(this) === content) newlineScans++
    return original.call(this, needle, offset)
  }
  try {
    // 7919 is coprime with20,000: visit every line once in nonmonotonic order.
    for (let i = 0; i < count; i++) {
      const line = ((i * 7919) % count) + 1
      const result = remapper({name: 'minified', file: 'app.js', line, col: 2} as Frame)
      expect(result?.name).toBe(`symbol_${line}`)
      expect(result?.line).toBe(line)
    }
    // One indexing pass plus at most a64-line checkpoint walk per lookup.
    // The old restart-at-source-start algorithm takes~200million scans here.
    expect(newlineScans).toBeLessThan(count * (SOURCE_LINE_CACHE_LIMITS.stride + 2))
  } finally {
    String.prototype.indexOf = original
  }
})

test('sparse indexes preserve CRLF, empty/final lines and replaced source contents', () => {
  const lookup = new SourceLineLookup()
  const first = 'alpha\r\n\nlast\r\n'
  const line = (value: string, number: number) => {
    const offsets = lookup.get('source', value, number)
    return offsets && value.slice(offsets.start, offsets.end)
  }
  expect([1, 2, 3, 4, 5].map(number => line(first, number))).toEqual([
    'alpha\r',
    '',
    'last\r',
    '',
    undefined,
  ])
  expect(line('replacement', 1)).toBe('replacement')
  expect(line('replacement', 2)).toBeUndefined()
  expect(lookup.get('source', first, 0)).toBeUndefined()
})

test('very many short lines compact checkpoints and LRU source indexes remain byte bounded', () => {
  const lookup = new SourceLineLookup()
  const content = '\n'.repeat(300000)
  for (let source = 0; source < 32; source++) {
    const number = 300001 - source * 1237
    expect(lookup.get(`source-${source}`, content, number)).toEqual({
      start: number - 1,
      end: number - 1,
    })
    expect(lookup.retainedCheckpointBytes).toBeLessThanOrEqual(
      SOURCE_LINE_CACHE_LIMITS.sources * SOURCE_LINE_CACHE_LIMITS.checkpoints * 4,
    )
  }
  // Eviction/re-indexing preserves both late and early line identity.
  expect(lookup.get('source-0', content, 300001)).toEqual({start: 300000, end: 300000})
  expect(lookup.get('source-0', content, 2)).toEqual({start: 1, end: 1})
})

test('source-map creation respects an already aborted preview signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    importJavaScriptSourceMapSymbolRemapper('{}', 'app.js.map', {signal: controller.signal}),
  ).rejects.toHaveProperty('name', 'AbortError')
})

test('V8 Windows paths remap with a local map at an exact first generated position', async () => {
  const profile = importFromV8ProfLog({
    code: [{type: 'JS', name: 'minified C:\\project files\\app.js:1:1'}],
    functions: [],
    ticks: [{tm: 1000, vm: 0, s: [0, -1]}],
  })
  const remapper = await importJavaScriptSourceMapSymbolRemapper(
    JSON.stringify({
      version: 3,
      sources: ['original.ts'],
      names: ['originalName'],
      mappings: 'AAAAA',
    }),
    'app.js.map',
  )
  expect(remapper).not.toBeNull()
  profile.remapSymbols(remapper!)
  const frames: Frame[] = []
  profile.forEachFrame(f => frames.push(f))
  expect(frames).toHaveLength(1)
  expect(frames[0]).toMatchObject({name: 'originalName', file: 'original.ts', line: 1, col: 1})
})

async function checkSourceMapApplication(pathToProfile: string, pathToSourceMap: string) {
  const buffer = fs.readFileSync(pathToProfile)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const profileGroup = await importProfilesFromArrayBuffer(
    path.basename(pathToProfile),
    arrayBuffer,
  )

  if (!profileGroup) {
    fail('Failed to extract profile')
    return
  }

  const sourceMapFileName = path.basename(pathToSourceMap)
  const remapper = await importJavaScriptSourceMapSymbolRemapper(
    fs.readFileSync(pathToSourceMap, 'utf-8'),
    sourceMapFileName,
  )

  if (!remapper) {
    fail('Failed to extract sourcemap')
    return
  }

  const key: (f: {name?: string; file?: string; line?: number; col?: number}) => string = f => {
    return `${f.name} @ ${f.file}:${f.line}:${f.col}`
  }

  const frames: Frame[] = []

  profileGroup.profiles[profileGroup.indexToView].forEachFrame(f => {
    frames.push(f)
  })

  frames.sort((a, b) => (a.key < b.key ? -1 : 1))

  const remappedFrames: string[] = []
  frames.forEach(f => {
    const remapped = remapper(f)
    if (!remapped) return
    remappedFrames.push(`(${key({...f, ...remapped})}) <- (${key(f)})`)
  })

  expect(remappedFrames).toMatchSnapshot()
}

test('source-map remapping of chrome-85-webpack', async () => {
  await checkSourceMapApplication(
    './sample/profiles/source-maps/chrome-85-webpack.json',
    './sample/profiles/source-maps/webpack/typescript-source-map-test.js.map',
  )
})

test('source-map remapping of firefox-79-webpack', async () => {
  await checkSourceMapApplication(
    './sample/profiles/source-maps/firefox-79-webpack.json',
    './sample/profiles/source-maps/webpack/typescript-source-map-test.js.map',
  )
})

test('source-map remapping of safari-13-webpack', async () => {
  await checkSourceMapApplication(
    './sample/profiles/source-maps/safari-13-webpack.json',
    './sample/profiles/source-maps/webpack/typescript-source-map-test.js.map',
  )
})

test('source-map remapping of chrome-85-esbuild', async () => {
  await checkSourceMapApplication(
    './sample/profiles/source-maps/chrome-85-esbuild.json',
    './sample/profiles/source-maps/esbuild/typescript-source-map-test.js.map',
  )
})

test('source-map remapping of chrome-85-parcel', async () => {
  await checkSourceMapApplication(
    './sample/profiles/source-maps/chrome-85-parcel.json',
    './sample/profiles/source-maps/parcel/typescript-source-map-test.js.map',
  )
})
