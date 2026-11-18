import fs from 'fs'
import path from 'path'
import {importProfilesFromArrayBuffer} from '../src/import'
import {
  combineProfiles,
  invertProfile,
  groupProfileByFile,
} from '../src/lib/profile-transformations'
import {exportProfileGroup} from '../src/lib/file-format'
import {exportProfileGroupToBlob} from '../src/lib/profile-export'

async function main() {
  const [filename, action = 'all'] = process.argv.slice(2)
  if (!['all', 'import', 'export', 'legacy-export'].includes(action))
    throw new Error(`Unknown action: ${action}`)
  const input = fs.readFileSync(filename)
  const start = Date.now()
  const group = await importProfilesFromArrayBuffer(
    path.basename(filename),
    input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  )
  if (!group) throw new Error('Unrecognized profile')
  console.log(
    JSON.stringify({
      action: 'import',
      ms: Date.now() - start,
      profiles: group.profiles.length,
      totals: group.profiles.map(p => p.getTotalWeight()),
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  )
  if (action === 'import') return
  ;(globalThis as any).gc?.()
  if (action === 'all') {
    let timer = Date.now()
    const combined = combineProfiles(group.profiles)
    console.log(
      JSON.stringify({action: 'combine', ms: Date.now() - timer, total: combined.getTotalWeight()}),
    )
    timer = Date.now()
    const inverted = invertProfile(combined)
    console.log(
      JSON.stringify({action: 'invert', ms: Date.now() - timer, total: inverted.getTotalWeight()}),
    )
    timer = Date.now()
    const grouped = groupProfileByFile(combined)
    console.log(
      JSON.stringify({action: 'file', ms: Date.now() - timer, total: grouped.getTotalWeight()}),
    )
    return
  }
  const before = process.memoryUsage()
  let maxHeap = before.heapUsed
  const sample = () => {
    maxHeap = Math.max(maxHeap, process.memoryUsage().heapUsed)
  }
  const timer = Date.now()
  let blob: Blob
  let yields = 0
  if (action === 'legacy-export') {
    const file = exportProfileGroup(group)
    const text = JSON.stringify(file)
    sample()
    blob = new Blob([text])
    sample()
  } else {
    blob = await exportProfileGroupToBlob(group, {
      onProgress: () => {
        yields++
        sample()
      },
    })
  }
  console.log(
    JSON.stringify({
      action,
      ms: Date.now() - timer,
      bytes: blob.size,
      progressUpdates: yields,
      baselineHeapMB: Math.round(before.heapUsed / 1048576),
      sampledPeakHeapMB: Math.round(maxHeap / 1048576),
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  )
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
