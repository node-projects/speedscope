import {test} from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {startServer} from './server.mjs'

test('CLI server serves assets and raw profiles, handles errors, and confines paths', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'speedscope-server-test-'))
  const dist = path.join(temp, 'dist')
  await fs.mkdir(dist)
  await fs.writeFile(path.join(dist, 'index.html'), '<title>speedscope</title>')
  await fs.writeFile(path.join(dist, 'test.wasm'), new Uint8Array([0, 97, 115, 109]))
  await fs.mkdir(path.join(temp, 'dist-other'))
  await fs.writeFile(path.join(temp, 'dist-other', 'secret.txt'), 'outside')
  await fs.mkdir(path.join(dist, 'directory'))
  await fs.symlink(path.join(temp, 'dist-other'), path.join(dist, 'external'), 'junction')
  const buffer = Buffer.from([31, 139, 0, 1, 2])
  const {server, port, profilePath} = await startServer(dist, {name: 'trace #%.gz', buffer})
  const request = (url, method = 'GET') =>
    new Promise((resolve, reject) => {
      http
        .request({hostname: '127.0.0.1', port, path: url, method}, res => {
          const chunks = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () =>
            resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}),
          )
        })
        .on('error', reject)
        .end()
    })
  try {
    assert.equal(server.address().address, '127.0.0.1')
    const index = await request('/')
    assert.equal(index.status, 200)
    assert.match(index.body.toString(), /speedscope/)
    assert.equal((await request('/test.wasm')).headers['content-type'], 'application/wasm')
    const profile = await request(profilePath)
    assert.deepEqual(profile.body, buffer)
    assert.equal(profile.headers['cache-control'], 'no-store')
    assert.equal((await request(profilePath, 'HEAD')).body.length, 0)
    for (const url of ['/missing', '/directory']) assert.equal((await request(url)).status, 404)
    for (const url of ['/%', '/%00']) assert.equal((await request(url)).status, 400)
    for (const url of ['/..%2fdist-other/secret.txt', '/..%5cdist-other/secret.txt']) {
      assert.notEqual((await request(url)).status, 200)
    }
    assert.equal((await request('/', 'POST')).status, 405)
    assert.equal((await request('/external/secret.txt')).status, 403)
    assert.equal((await request('/')).status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    await fs.rm(temp, {recursive: true, force: true})
  }
})
