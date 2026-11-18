import * as esbuild from 'esbuild'
import * as path from 'path'

export const profileWorkerPlugin: esbuild.Plugin = {
  name: 'trace-import-worker',
  setup(build) {
    build.onLoad({filter: /[\\/]trace-worker-source\.ts$/}, async () => {
      const result = await esbuild.build({
        entryPoints: ['src/import/trace-worker.ts'],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        minify: true,
        metafile: true,
        loader: {'.wasm': 'binary'},
      })
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`,
        loader: 'js',
        watchFiles: Object.keys(result.metafile!.inputs).map(file => path.resolve(file)),
      }
    })
  },
}
