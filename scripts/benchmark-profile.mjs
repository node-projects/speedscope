import {build} from 'esbuild'
import {execFileSync} from 'node:child_process'

if (!process.argv[2]) {
  console.error(
    'Usage: node scripts/benchmark-profile.mjs <profile-path> [all|import|stream-import|text-stream-import|text-stream-main-import|stream-search|export|legacy-export] [search-query]',
  )
  process.exit(1)
}
const result = await build({
  entryPoints: ['scripts/benchmark-profile.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: {'.wasm': 'binary'},
  write: false,
})
execFileSync(
  process.execPath,
  ['--expose-gc', '--input-type=commonjs', '-', ...process.argv.slice(2)],
  {
    input: result.outputFiles[0].text,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
)
