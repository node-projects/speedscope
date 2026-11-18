import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

async function extractFixtures(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name)
    if (filename.includes('Instruments')) continue
    if (entry.isDirectory()) await extractFixtures(filename)
    else if (entry.name.endsWith('.zip')) {
      const root = path.resolve(directory)
      const zip = await JSZip.loadAsync(await readFile(filename))
      for (const file of Object.values(zip.files)) {
        const target = path.resolve(root, file.name)
        const relative = path.relative(root, target)
        if (
          relative === '..' ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) {
          throw new Error(`Unsafe fixture path: ${file.name}`)
        }
        if (file.dir) await mkdir(target, {recursive: true})
        else {
          await mkdir(path.dirname(target), {recursive: true})
          await writeFile(target, await file.async('nodebuffer'))
        }
      }
    }
  }
}
await extractFixtures('sample/profiles')
