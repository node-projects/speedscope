import * as esbuild from 'esbuild'
import {existsSync, mkdirSync} from 'fs'
import {buildOptions, generateIndexHtml} from './esbuild-shared'

async function main() {
  const configuredPort = process.env.SPEEDSCOPE_PORT
  const requestedPort = configuredPort == null ? 8000 : Number(configuredPort)
  if (
    (configuredPort != null && !/^\d+$/.test(configuredPort)) ||
    !Number.isInteger(requestedPort) ||
    requestedPort < 1 ||
    requestedPort > 65535
  ) {
    throw new Error('SPEEDSCOPE_PORT must be an integer between 1 and 65535')
  }
  const outdir = 'dist'
  if (!existsSync(outdir)) {
    mkdirSync(outdir)
  }
  let ctx = await esbuild.context({
    ...buildOptions,
    outdir,
    write: false,
    metafile: true,
    plugins: [
      ...(buildOptions.plugins || []),
      {
        name: 'speedscope-dev-server',
        setup(build) {
          build.onEnd(buildResult => {
            generateIndexHtml({
              buildResult,
              outdir,
              servingProtocol: 'http',
            })
          })
        },
      },
    ],
  })

  await ctx.rebuild()

  let {hosts, port} = await ctx.serve({
    servedir: outdir,
    port: requestedPort,
  })

  console.log(`Server is running at http://${hosts[0]}:${port}`)
}

main()
