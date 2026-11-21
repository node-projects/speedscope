import {importProfilesFromArrayBuffer} from './index'
import {TraceWorkerRequest, TraceWorkerResponse, ImportPhase} from './trace-worker-protocol'
import {snapshotTransferables} from '../lib/profile-snapshot'
import {tryImportDurationTrace} from './streaming-trace'
import {checkJavaThreadDumpZipFileSize} from './java-thread-dump-zip'

export async function processTraceInWorker(
  request: TraceWorkerRequest,
  progress: (phase: ImportPhase) => void,
): Promise<TraceWorkerResponse> {
  progress('Reading profile')
  if (!(request.input instanceof ArrayBuffer)) await checkJavaThreadDumpZipFileSize(request.input)
  let group = await tryImportDurationTrace(request.input, request.name, {
    onProgress: () => progress('Streaming profile'),
  })
  let buffer: ArrayBuffer | undefined
  try {
    if (!group) {
      buffer =
        request.input instanceof ArrayBuffer ? request.input : await request.input.arrayBuffer()
      progress('Parsing profile')
      group = await importProfilesFromArrayBuffer(request.name, buffer, {
        onProgress: update => progress(update.phase),
      })
    }
  } catch (error) {
    // Some host-specific formats need DOM APIs unavailable in a worker. Return
    // ownership of the bytes before trying the original main-thread importer.
    if (error instanceof ReferenceError && /DOMParser|document|window/.test(error.message))
      return {type: 'fallback', buffer}
    throw error
  }
  if (!group) return {type: 'fallback', buffer}
  progress('Building profile')
  for (const profile of group.profiles) await profile.demangle()
  progress('Preparing view')
  return {type: 'result', group: {...group, profiles: group.profiles.map(p => p.toSnapshot())}}
}

// Avoid adding the conflicting DOM + WebWorker global lib declarations.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as {
    onmessage: (event: MessageEvent<TraceWorkerRequest>) => void
    postMessage(message: TraceWorkerResponse, transfer?: ArrayBuffer[]): void
    close(): void
  }
  scope.onmessage = async event => {
    try {
      const response = await processTraceInWorker(event.data, phase =>
        scope.postMessage({type: 'progress', phase}),
      )
      const buffers =
        response.type === 'result'
          ? snapshotTransferables(response.group)
          : response.type === 'fallback' && response.buffer
            ? [response.buffer]
            : []
      scope.postMessage(response, buffers)
    } catch (error) {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      scope.close()
    }
  }
}
