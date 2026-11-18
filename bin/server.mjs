import http from 'node:http'
import path from 'node:path'
import {promises as fs} from 'node:fs'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

function isWithin(root, target) {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function startServer(serveDir, profile = null) {
  const root = await fs.realpath(serveDir)
  const profilePath = profile ? `/__speedscope_profile__/${encodeURIComponent(profile.name)}` : null
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {Allow: 'GET, HEAD'})
      res.end()
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      if (pathname.includes('\0')) throw new Error('Invalid path')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    if (profile && pathname === decodeURIComponent(profilePath)) {
      res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store'})
      res.end(req.method === 'HEAD' ? undefined : profile.buffer)
      return
    }
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!isWithin(root, target)) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      // Check the resolved target too, so symlinks cannot expose files outside dist.
      const realTarget = await fs.realpath(target)
      if (!isWithin(root, realTarget)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (!(await fs.stat(realTarget)).isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      const data = req.method === 'HEAD' ? undefined : await fs.readFile(realTarget)
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(realTarget)] || 'application/octet-stream',
      })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {server, port: server.address().port, profilePath}
}
