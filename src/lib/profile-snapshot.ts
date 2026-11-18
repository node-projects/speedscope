import type {FrameInfo} from './profile'
import type {FileFormat} from './file-format-spec'

// Internal worker transport, not an interchange format or a public package API.
// Node records contain frame index, parent index, total weight and self weight.
export interface ProfileSnapshot {
  name: string
  unit: FileFormat.ValueUnit
  totalWeight: number
  chronological: boolean
  derived: boolean
  frames: FrameInfo[]
  frameWeights: Float64Array
  appendNodes: Float64Array
  groupedNodes: Float64Array
  samples: Uint32Array
  weights: Float64Array
}

export interface ProfileGroupSnapshot {
  name: string
  indexToView: number
  profiles: ProfileSnapshot[]
}

export function snapshotTransferables(group: ProfileGroupSnapshot): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = []
  for (const p of group.profiles) {
    for (const array of [p.frameWeights, p.appendNodes, p.groupedNodes, p.samples, p.weights])
      buffers.push(array.buffer as ArrayBuffer)
  }
  return buffers
}

export interface HydrationOptions {
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}
