import {mkdir, readFile, writeFile, readdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const args = process.argv.slice(2)
if (
  args.length &&
  (args.length !== 2 || args[0] !== '--protocol' || !['file', 'http'].includes(args[1]))
) {
  throw new Error('Usage: prepare-release.mjs [--protocol file|http]')
}
const protocol = args[1] || 'file'
const target = protocol === 'http' ? 'dist/pages' : 'dist/release'
// A fresh directory avoids stale hashed assets without deleting an existing build.
const {mkdtemp, rename} = await import('node:fs/promises')
await mkdir('dist', {recursive: true})
const outdir = await mkdtemp(path.join(root, 'dist', 'release-'))
const run = (script, args = []) =>
  execFileSync(process.execPath, [script, ...args], {encoding: 'utf8'})
await writeFile(
  path.join(outdir, 'file-format-schema.json'),
  run('scripts/generate-file-format-schema-json.js'),
)
await writeFile(
  path.join(outdir, 'source-code-pro.LICENSE.md'),
  await readFile('assets/source-code-pro/LICENSE.md'),
)
await writeFile(path.join(outdir, 'LICENSE'), await readFile('LICENSE'))
await writeFile(
  path.join(outdir, 'streamparser-json.LICENSE'),
  await readFile('node_modules/@streamparser/json/LICENSE'),
)
await writeFile(
  path.join(outdir, 'release.txt'),
  `${pkg.name}@${pkg.version}\n${new Date().toISOString()}\n${execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    {encoding: 'utf8'},
  )}`,
)
console.log(
  run(require.resolve('tsx/cli'), [
    'scripts/build-release.ts',
    '--outdir',
    outdir,
    '--protocol',
    protocol,
  ]),
)
// Preserve earlier builds so this command is safe to rerun during development.
try {
  await rename(target, `${outdir}-previous`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await rename(outdir, target)
if (protocol === 'http') {
  await writeFile(path.join(target, '.nojekyll'), '')
  console.log(`GitHub Pages site: ${target}`)
  process.exit(0)
}
const zip = new JSZip()
for (const entry of await readdir('dist/release', {withFileTypes: true})) {
  if (entry.isFile() && !entry.name.endsWith('.map'))
    zip.file(entry.name, await readFile(path.join('dist/release', entry.name)))
}
const zipPath = `dist/speedscope-${pkg.version}.zip`
await writeFile(zipPath, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}))
console.log(`Standalone archive: ${zipPath}`)
