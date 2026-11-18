import {execFileSync} from 'node:child_process'
import {appendFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

export function parseReleaseVersion(tag, metadata) {
  if (typeof tag !== 'string') throw new Error('RELEASE_TAG is required')
  const version = tag.replace(/^v/, '')
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    )
  if (
    !match ||
    match[0] !== version ||
    match.slice(1, 4).some(n => !Number.isSafeInteger(Number(n))) ||
    match[4]?.split('.').some(id => /^\d+$/.test(id) && id.length > 1 && id[0] === '0')
  ) {
    throw new Error(
      'Release tag must be X.Y.Z or vX.Y.Z, optionally with a SemVer prerelease (no build metadata)',
    )
  }
  if (
    metadata &&
    (metadata.tagName !== tag ||
      metadata.isDraft !== false ||
      typeof metadata.isPrerelease !== 'boolean')
  ) {
    throw new Error('Release metadata must describe the same published, non-draft release tag')
  }
  return {version, distTag: match[4] || metadata?.isPrerelease ? 'next' : 'latest'}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const metadata = process.env.RELEASE_METADATA
    ? JSON.parse(process.env.RELEASE_METADATA)
    : undefined
  const {version, distTag} = parseReleaseVersion(process.env.RELEASE_TAG, metadata)
  if (!process.env.npm_execpath) throw new Error('Run this script through npm run release:version')
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'version',
      version,
      '--no-git-tag-version',
      '--ignore-scripts',
      '--allow-same-version',
    ],
    {stdio: 'inherit'},
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ndist-tag=${distTag}\n`)
  console.log(`Release package version: ${version}; npm dist-tag: ${distTag}`)
}
