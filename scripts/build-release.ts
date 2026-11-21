import * as esbuild from 'esbuild'
import {buildOptions, generateIndexHtml} from './esbuild-shared'
import {createHash} from 'crypto'
import {promises as fs} from 'fs'
import * as path from 'path'
import {
  isOfflineShellAsset,
  offlineWorkerSource,
  offlineWorkerRuntime,
  offlineRegistrationScript,
} from '../src/lib/offline-shell'

function parseArgs() {
  const args = process.argv.slice(2)
  const result: {outdir?: string; protocol?: 'http' | 'file'} = {}

  for (let i = 0; i < args.length; i += 2) {
    switch (args[i]) {
      case '--outdir':
        result.outdir = args[i + 1]
        break
      case '--protocol':
        result.protocol = args[i + 1] as 'http' | 'file'
        break
    }
  }
  return result
}

async function main() {
  const {outdir, protocol: servingProtocol} = parseArgs()

  if (!outdir || !servingProtocol) {
    console.error('Usage: build-release.ts --outdir <outdir> --protocol <serving_protocol>')
    process.exit(1)
  }

  if (servingProtocol !== 'http' && servingProtocol !== 'file') {
    console.error('serving_protocol must be either "http" or "file"')
    process.exit(1)
  }

  let buildResult = await esbuild.build({
    ...buildOptions,
    minify: true,
    metafile: true,
    ...(servingProtocol === 'file'
      ? {
          format: 'iife',
          splitting: false,
          target: 'es2020',
          loader: {...buildOptions.loader, '.wasm': 'binary'},
        }
      : {}),
    outdir,
  })

  generateIndexHtml({
    buildResult,
    outdir,
    servingProtocol,
    offline: servingProtocol === 'http',
  })

  if (servingProtocol === 'http') {
    const assets = (await fs.readdir(outdir)).filter(isOfflineShellAsset).sort()
    const hash = createHash('sha256').update(offlineWorkerRuntime).update(offlineRegistrationScript)
    let bytes = 0
    for (const name of assets) {
      const data = await fs.readFile(path.join(outdir, name))
      bytes += data.byteLength
      hash.update(name + '\0').update(data)
    }
    if (bytes > 16 * 1024 * 1024) throw new Error('Offline app shell exceeds 16 MiB')
    await fs.writeFile(
      path.join(outdir, 'service-worker.js'),
      offlineWorkerSource(hash.digest('hex'), assets),
    )
  }

  console.log(`Successfully built to ${outdir}`)
}

main()
