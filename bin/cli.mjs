#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import {startServer} from './server.mjs'
import os from 'node:os'
import stream from 'node:stream'
import {fileURLToPath, pathToFileURL} from 'node:url'

import open from 'open'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const helpString = `Usage: speedscope [--serve] [filepath]

If invoked with no arguments, will open a local copy of speedscope in your default browser.
Once open, you can browse for a profile to import.

If - is used as the filepath, will read from stdin instead.

  cat /path/to/profile | speedscope -

Options:
  --serve   Start a local HTTP server instead of using file:// URLs
`

function getProfileStream(relPath) {
  const absPath = path.resolve(process.cwd(), relPath)
  if (relPath === '-') {
    // Read from stdin
    return process.stdin
  } else {
    return fs.createReadStream(absPath)
  }
}

function getProfileBuffer(relPath) {
  const profileStream = getProfileStream(relPath)
  const chunks = []
  return new Promise((resolve, reject) => {
    profileStream.pipe(
      stream.Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk)
          callback()
        },
        final() {
          resolve(Buffer.concat(chunks))
        },
      }),
    )
    profileStream.on('error', ev => reject(ev))
  })
}

function buildProfileJs(filename, sourceBuffer) {
  try {
    const sourceBase64 = sourceBuffer.toString('base64')
    return `speedscope.loadFileFromBase64(${JSON.stringify(filename)}, ${JSON.stringify(
      sourceBase64,
    )})`
  } catch (e) {
    if (e && e.message && /Cannot create a string longer than/.exec(e.message)) {
      return `alert("Sorry, ${filename} is too large to be loaded via command-line argument! Try dragging it into speedscope instead.")`
    } else {
      throw e
    }
  }
}

async function mainFile(filePath) {
  let urlToOpen = pathToFileURL(path.resolve(__dirname, '../dist/release/index.html')).href

  if (filePath) {
    const sourceBuffer = await getProfileBuffer(filePath)
    const filename = path.basename(filePath)
    const jsSource = buildProfileJs(filename, sourceBuffer)

    const tempRoot = path.join(os.tmpdir(), 'speedscope')
    fs.mkdirSync(tempRoot, {recursive: true})
    const tempDir = fs.mkdtempSync(path.join(tempRoot, 'profile-'))
    const jsPath = path.join(tempDir, 'Source.js')
    console.log(`Creating temp file ${jsPath}`)
    fs.writeFileSync(jsPath, jsSource)
    urlToOpen += `#localProfilePath=${encodeURIComponent(pathToFileURL(jsPath).href)}`

    // For some silly reason, the macOS `open` and Windows `start` commands ignore hash parameters
    // passed as part of the URL. To get around this weird issue, we'll create a local HTML file
    // that just redirects.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const htmlPath = path.join(tempDir, `Wrapper.html`)
      console.log(`Creating temp file ${htmlPath}`)
      fs.writeFileSync(htmlPath, `<script>window.location=${JSON.stringify(urlToOpen)}</script>`)

      urlToOpen = pathToFileURL(htmlPath).href
    }
  }

  console.log('Opening', urlToOpen, 'in your default browser')

  // We'd like to avoid blocking the terminal on the browsing closing,
  // but for some reason this doesn't work at all on Windows if we
  // don't use wait: true.
  const wait = process.platform === 'win32'
  await open(urlToOpen, {wait})
}

async function mainServe(filePath) {
  const serveDir = path.resolve(__dirname, '../dist/release')
  const profile = filePath
    ? {name: path.basename(filePath), buffer: await getProfileBuffer(filePath)}
    : null
  const {server, port, profilePath} = await startServer(serveDir, profile)
  const baseURL = `http://127.0.0.1:${port}/`
  const urlToOpen = profilePath
    ? `${baseURL}#profileURL=${encodeURIComponent(new URL(profilePath, baseURL).href)}`
    : baseURL

  console.log(`speedscope is running at ${urlToOpen}`)
  console.log('Press Ctrl+C to stop')

  try {
    await open(urlToOpen)
  } catch (e) {
    server.close()
    throw e
  }

  // Keep the process alive to serve requests
  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    server.close()
    process.exit(0)
  })
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(helpString)
    return
  }

  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const json = fs.readFileSync(path.resolve(__dirname, '../package.json'), {encoding: 'utf-8'})
    const {version} = JSON.parse(json)
    console.log(`v${version}`)
    return
  }

  const serve = process.argv.includes('--serve')
  const args = process.argv.slice(2).filter(a => a !== '--serve')

  if (args.length > 1) {
    throw new Error('At most one filepath argument expected')
  }

  const filePath = args[0] || null

  if (serve) {
    await mainServe(filePath)
  } else {
    await mainFile(filePath)
  }
}

main().catch(e => {
  console.log(e.stack + '\n')
  console.log(helpString)
  process.exit(1)
})
