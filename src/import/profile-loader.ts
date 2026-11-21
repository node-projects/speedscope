import {Profile, ProfileGroup} from '../lib/profile'
import {decodeBase64} from '../lib/utils'
import workerSource from './trace-worker-source'
import {ImportProgress, TraceWorkerResponse} from './trace-worker-protocol'
import {textProfileKind, tryImportTextProfile} from './streaming-text-profile'

const importer = () => import('./index')
const preparedGroups = new WeakSet<ProfileGroup>()
export function wereSymbolsLoaded(group: ProfileGroup): boolean {
  return preparedGroups.has(group)
}
export interface ImportOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImportProgress) => void
  workerFactory?: () => Worker
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
}

export function shouldUseTraceWorker(name: string, size: number): boolean {
  // Detection belongs in the worker's existing generic importer. Extension
  // allowlists leave large perf/folded/JFR/pprof files (and renamed captures)
  // blocking the UI, even though those importers are already worker-safe.
  // A tiny compressed stack file can expand into hundreds of MiB. Prefer the
  // faster externally cancellable worker before looking at compressed size.
  return size >= 1024 * 1024 || (/\.gz$/i.test(name) && textProfileKind(name) !== null)
}

async function loadWithWorker(
  name: string,
  input: ArrayBuffer | File,
  options: ImportOptions,
): Promise<ProfileGroup | ArrayBuffer | null> {
  checkAbort(options.signal)
  let url: string | null = null
  let worker: Worker
  try {
    if (options.workerFactory) worker = options.workerFactory()
    else {
      if (!workerSource || typeof Worker === 'undefined') return null
      url = URL.createObjectURL(new Blob([workerSource], {type: 'application/javascript'}))
      worker = new Worker(url)
    }
  } catch {
    if (url) URL.revokeObjectURL(url)
    return null // Worker/Blob creation can be blocked by a host's CSP.
  }
  const cleanup = () => {
    worker.terminate()
    if (url) URL.revokeObjectURL(url)
    options.signal?.removeEventListener('abort', abort)
  }
  let abort: () => void = () => {}
  try {
    options.onProgress?.({phase: 'Reading profile', canCancel: true})
    checkAbort(options.signal)
    return await new Promise<ProfileGroup | ArrayBuffer | null>((resolve, reject) => {
      let received = false
      abort = () => reject(new DOMException('Import cancelled', 'AbortError'))
      options.signal?.addEventListener('abort', abort, {once: true})
      worker.onerror = () => {
        // Startup failure can fall back for a File (which can be reread). After
        // transferring a buffer, report failure rather than importing empty data.
        if (!received && !(input instanceof ArrayBuffer)) resolve(null)
        else
          reject(
            new Error(
              'The profile importer stopped unexpectedly. Try a smaller capture or a different browser.',
            ),
          )
      }
      worker.onmessage = async (event: MessageEvent<TraceWorkerResponse>) => {
        received = true
        try {
          checkAbort(options.signal)
          const message = event.data
          if (message.type === 'progress')
            options.onProgress?.({phase: message.phase, canCancel: true})
          else if (message.type === 'fallback') {
            if (!message.buffer && input instanceof ArrayBuffer && input.byteLength === 0)
              throw new Error('The profile importer did not return ownership of the input buffer.')
            resolve(message.buffer || null)
          } else if (message.type === 'error') reject(new Error(message.message))
          else {
            // Release the worker's parsed input and trees before creating UI objects.
            worker.terminate()
            options.onProgress?.({phase: 'Preparing view', canCancel: true})
            const profiles: Profile[] = []
            for (const data of message.group.profiles)
              profiles.push(await Profile.fromSnapshot(data, {signal: options.signal}))
            checkAbort(options.signal)
            const group = {...message.group, profiles}
            preparedGroups.add(group)
            resolve(group)
          }
        } catch (error) {
          reject(error)
        }
      }
      worker.postMessage({name, input}, input instanceof ArrayBuffer ? [input] : [])
    })
  } finally {
    cleanup()
  }
}

export async function importProfileFile(
  file: File,
  options: ImportOptions = {},
): Promise<ProfileGroup | null> {
  if (shouldUseTraceWorker(file.name, file.size)) {
    const result = await loadWithWorker(file.name, file, options)
    if (result && !(result instanceof ArrayBuffer)) return result
    // Returned input avoids rereading on a normal unsupported-format fallback.
    if (result instanceof ArrayBuffer) return importProfileBuffer(file.name, result, options, false)
  }
  checkAbort(options.signal)
  const streamed = await tryImportTextProfile(file, file.name, {
    signal: options.signal,
    onProgress: () => options.onProgress?.({phase: 'Streaming profile', canCancel: true}),
  })
  if (streamed) return streamed
  checkAbort(options.signal)
  options.onProgress?.({phase: 'Reading profile', canCancel: false})
  const module = await importer()
  checkAbort(options.signal)
  return module.importProfilesFromFile(file, {
    signal: options.signal,
    onProgress: options.onProgress,
  })
}

export async function importProfileBuffer(
  name: string,
  buffer: ArrayBuffer,
  options: ImportOptions = {},
  useWorker = true,
): Promise<ProfileGroup | null> {
  if (useWorker && shouldUseTraceWorker(name, buffer.byteLength)) {
    const result = await loadWithWorker(name, buffer, options)
    if (result && !(result instanceof ArrayBuffer)) return result
    if (result instanceof ArrayBuffer) buffer = result
  }
  checkAbort(options.signal)
  const streamed = await tryImportTextProfile(buffer, name, {
    signal: options.signal,
    onProgress: () => options.onProgress?.({phase: 'Streaming profile', canCancel: true}),
  })
  if (streamed) return streamed
  checkAbort(options.signal)
  options.onProgress?.({phase: 'Reading profile', canCancel: false})
  const module = await importer()
  checkAbort(options.signal)
  return module.importProfilesFromArrayBuffer(name, buffer, {
    signal: options.signal,
    onProgress: options.onProgress,
  })
}

export async function importProfileBase64(
  name: string,
  text: string,
  options: ImportOptions = {},
): Promise<ProfileGroup | null> {
  return importProfileBuffer(name, decodeBase64(text).buffer as ArrayBuffer, options)
}
