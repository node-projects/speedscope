import {build} from 'esbuild'
import {mkdir, readFile, writeFile} from 'fs/promises'
import {buildOptions} from './esbuild-shared'
import {createHash} from 'crypto'

async function main() {
  const result = await build({
    ...buildOptions,
    entryPoints: ['src/speedscope.tsx'],
    outfile: 'single-file.js',
    write: false,
    metafile: true,
    format: 'iife',
    splitting: false,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    legalComments: 'inline',
    supported: {'inline-script': true, 'inline-style': true},
    loader: {
      ...buildOptions.loader,
      '.txt': 'dataurl',
      '.woff2': 'dataurl',
      '.png': 'dataurl',
      '.ico': 'dataurl',
      '.wasm': 'binary',
    },
  })
  const js = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text
  // Refuse a future build configuration that leaves assets/chunks external.
  if (
    result.outputFiles.length !== 2 ||
    Object.values(result.metafile!.outputs).some(output =>
      output.imports.some(item => !item.path.startsWith('data:')),
    ) ||
    /<\/script/i.test(js) ||
    /<\/style/i.test(css)
  )
    throw new Error('Single-file build emitted unexpected assets or unsafe inline content')
  const icon = (await readFile('assets/favicon-32x32.png')).toString('base64')
  const licenses = {
    speedscope: await readFile('LICENSE', 'utf8'),
    'Source Code Pro': await readFile('assets/source-code-pro/LICENSE.md', 'utf8'),
    '@streamparser/json': await readFile('node_modules/@streamparser/json/LICENSE', 'utf8'),
  }
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>speedscope</title>
<link rel="icon" type="image/png" href="data:image/png;base64,${icon}">
<style>${css}</style></head><body>
<script type="application/json" id="speedscope-licenses">${JSON.stringify(licenses).replace(
    /</g,
    '\\u003c',
  )}</script>
<script>${js}</script></body></html>
`
  await mkdir('dist', {recursive: true})
  const filename = 'dist/speedscope-standalone.html'
  await writeFile(filename, html)
  console.log(`Single-file app: ${filename} (${Buffer.byteLength(html).toLocaleString()} bytes)`)
  console.log(
    `Inline app script CSP hash: 'sha256-${createHash('sha256').update(js).digest('base64')}'`,
  )
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
