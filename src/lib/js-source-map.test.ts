import * as fs from 'fs'
import * as path from 'path'
import {importProfilesFromArrayBuffer} from '../import'
import {importJavaScriptSourceMapSymbolRemapper} from './js-source-map'
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
