import assert from 'node:assert/strict'
import test from 'node:test'
import {parseReleaseVersion} from './set-release-version.mjs'
import {isVersionPublished} from './npm-release-status.mjs'
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

test('release tags determine npm versions and prerelease channels', () => {
  assert.deepEqual(parseReleaseVersion('v2.4.6'), {version: '2.4.6', distTag: 'latest'})
  assert.deepEqual(parseReleaseVersion('2.4.6-rc.1'), {version: '2.4.6-rc.1', distTag: 'next'})
  assert.deepEqual(
    parseReleaseVersion('v2.4.6', {tagName: 'v2.4.6', isDraft: false, isPrerelease: true}),
    {version: '2.4.6', distTag: 'next'},
  )
})

test('invalid or ambiguous release versions are rejected before invoking npm', () => {
  for (const value of [
    undefined,
    '',
    'main',
    '1.2',
    'v01.2.3',
    '1.2.3-01',
    '1.2.3+',
    '1.2.3+build',
    '1.2.3;echo hacked',
    '1.2.3\n',
    '9007199254740992.0.0',
  ]) {
    assert.throws(() => parseReleaseVersion(value))
  }
  assert.throws(() =>
    parseReleaseVersion('v1.2.3', {tagName: 'v1.2.4', isDraft: false, isPrerelease: false}),
  )
  assert.throws(() =>
    parseReleaseVersion('v1.2.3', {tagName: 'v1.2.3', isDraft: true, isPrerelease: false}),
  )
})

test('registry lookup skips existing versions but never treats outages as unpublished', async () => {
  const pkg = {name: '@node-projects/speedscope', version: '2.0.0'}
  assert.equal(await isVersionPublished(pkg, async () => new Response(null, {status: 404})), false)
  assert.equal(
    await isVersionPublished(pkg, async () => new Response(JSON.stringify(pkg), {status: 200})),
    true,
  )
  await assert.rejects(isVersionPublished(pkg, async () => new Response(null, {status: 503})))
  await assert.rejects(
    isVersionPublished(
      pkg,
      async () => new Response(JSON.stringify({...pkg, version: '1.0.0'}), {status: 200}),
    ),
  )
})

test(
  'release helper writes both manifests and workflow outputs without creating a tag',
  {skip: !process.env.npm_execpath},
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'speedscope-release-test-'))
    try {
      const pkg = {name: '@node-projects/speedscope-test', version: '0.0.0'}
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify(pkg))
      writeFileSync(
        path.join(directory, 'package-lock.json'),
        JSON.stringify({...pkg, lockfileVersion: 3, packages: {'': pkg}}),
      )
      const output = path.join(directory, 'outputs')
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('./set-release-version.mjs', import.meta.url))],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            RELEASE_TAG: 'v3.2.1-rc.2',
            RELEASE_METADATA: JSON.stringify({
              tagName: 'v3.2.1-rc.2',
              isDraft: false,
              isPrerelease: true,
            }),
            GITHUB_OUTPUT: output,
          },
        },
      )
      assert.equal(
        JSON.parse(readFileSync(path.join(directory, 'package.json'))).version,
        '3.2.1-rc.2',
      )
      const lock = JSON.parse(readFileSync(path.join(directory, 'package-lock.json')))
      assert.equal(lock.version, '3.2.1-rc.2')
      assert.equal(lock.packages[''].version, '3.2.1-rc.2')
      assert.equal(readFileSync(output, 'utf8'), 'version=3.2.1-rc.2\ndist-tag=next\n')
    } finally {
      // This test only removes its own verified temporary project.
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
      assert.ok(path.basename(directory).startsWith('speedscope-release-test-'))
      rmSync(directory, {recursive: true, force: true})
    }
  },
)
