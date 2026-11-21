import type {FrameInfo, TimelineOrigin} from './profile'
import type {FileFormat} from './file-format-spec'
import type {CounterTrack} from './counter-track'
import type {InstantTrack, InstantEventOmission} from './instant-track'

// Internal worker transport, not an interchange format or a public package API.
// Node records contain frame index, parent index, total weight and self weight.
export interface ProfileSnapshot {
  name: string
  unit: FileFormat.ValueUnit
  totalWeight: number
  chronological: boolean
  derived: boolean
  timeline?: TimelineOrigin
  frames: FrameInfo[]
  frameWeights: Float64Array
  appendNodes: Float64Array
  groupedNodes: Float64Array
  samples: Uint32Array
  weights: Float64Array
}

export interface ProfileGroupSnapshot {
  name: string
  sourceName?: string
  indexToView: number
  profiles: ProfileSnapshot[]
  counterTracks?: readonly CounterTrack[]
  instantTracks?: readonly InstantTrack[]
  instantEventOmission?: InstantEventOmission
}

export function snapshotTransferables(group: ProfileGroupSnapshot): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const p of group.profiles) {
    for (const array of [p.frameWeights, p.appendNodes, p.groupedNodes, p.samples, p.weights])
      buffers.add(array.buffer as ArrayBuffer)
  }
  for (const track of group.counterTracks || []) {
    buffers.add(track.times.buffer as ArrayBuffer)
    buffers.add(track.values.buffer as ArrayBuffer)
  }
  for (const track of group.instantTracks || []) buffers.add(track.times.buffer as ArrayBuffer)
  return [...buffers]
}

export interface HydrationOptions {
  signal?: AbortSignal
  yieldControl?: () => Promise<void>
}
