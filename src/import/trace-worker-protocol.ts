import type {ProfileGroupSnapshot} from '../lib/profile-snapshot'

export interface TraceWorkerRequest {
  name: string
  input: ArrayBuffer | File
}
export type ImportPhase =
  | 'Reading profile'
  | 'Parsing profile'
  | 'Building profile'
  | 'Preparing view'
export interface ImportProgress {
  phase: ImportPhase
  canCancel: boolean
}
export type TraceWorkerResponse =
  | {type: 'progress'; phase: ImportPhase}
  | {type: 'result'; group: ProfileGroupSnapshot}
  | {type: 'fallback'; buffer?: ArrayBuffer}
  | {type: 'error'; message: string}
