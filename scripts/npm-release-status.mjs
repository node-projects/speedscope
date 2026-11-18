import {readFileSync, appendFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

export async function isVersionPublished(pkg, fetcher = fetch) {
  const response = await fetcher(
    `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
  )
  if (response.status !== 404 && !response.ok)
    throw new Error(`npm registry check failed: HTTP ${response.status}`)
  const published = response.status !== 404
  if (published) {
    const existing = await response.json()
    if (existing.name !== pkg.name || existing.version !== pkg.version)
      throw new Error('Unexpected npm package metadata')
  }
  return published
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const published = await isVersionPublished(pkg)
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`)
  console.log(
    `${pkg.name}@${pkg.version}: ${
      published ? 'already published; npm publish will be skipped' : 'not published yet'
    }`,
  )
}
