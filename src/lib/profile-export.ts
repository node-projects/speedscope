import {Frame, ProfileGroup} from './profile'
import {FileFormat} from './file-format-spec'

export interface ExportProgress {
  profilesCompleted: number
  profileCount: number
  eventsWritten: number
  framesWritten: number
  frameCount: number
}

export interface ExportOptions {
  signal?: AbortSignal
  onProgress?: (progress: ExportProgress) => void
  // Allows callers/tests to choose a scheduler without coupling export to the UI.
  yieldControl?: () => Promise<void>
}

// Bound individual strings and temporary event objects. Blob parts hold encoded
// bytes; we never construct a second full event tree or a trace-sized JS string.
export async function exportProfileGroupToBlob(
  group: ProfileGroup,
  options: ExportOptions = {},
): Promise<Blob> {
  const parts: Blob[] = []
  let pieces: string[] = []
  let characters = 0
  const frames: Frame[] = []
  const frameIndexes = new Map<Frame, number>()
  const progress: ExportProgress = {
    profilesCompleted: 0,
    profileCount: group.profiles.length,
    eventsWritten: 0,
    framesWritten: 0,
    frameCount: 0,
  }
  // Message tasks yield to input/rendering without nested timer clamping, which
  // can otherwise make a background-tab export take seconds between batches.
  const channel =
    !options.yieldControl && typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
  const yieldControl =
    options.yieldControl ||
    (() =>
      new Promise<void>(resolve => {
        if (channel) {
          channel.port1.onmessage = () => resolve()
          channel.port2.postMessage(null)
        } else setTimeout(resolve, 0)
      }))
  function checkAbort() {
    if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
  }
  function flush() {
    if (pieces.length) parts.push(new Blob([pieces.join('')], {type: 'application/json'}))
    pieces = []
    characters = 0
  }
  function write(text: string) {
    pieces.push(text)
    characters += text.length
    if (characters >= 1 << 20) flush()
  }
  async function pause() {
    checkAbort()
    flush()
    options.onProgress?.({...progress})
    await yieldControl()
    checkAbort()
  }

  try {
    await pause()
    write(
      JSON.stringify({
        exporter: `${require('../../package.json').name}@${require('../../package.json').version}`,
        name: group.name,
        activeProfileIndex: group.indexToView,
        $schema: 'https://www.speedscope.app/file-format-schema.json',
      }).slice(0, -1) + ',"profiles":[',
    )
    for (let index = 0; index < group.profiles.length; index++) {
      const profile = group.profiles[index]
      if (index) write(',')
      write(
        JSON.stringify({
          type: FileFormat.ProfileType.EVENTED,
          name: profile.getName(),
          unit: profile.getWeightUnit(),
          startValue: 0,
          endValue: profile.getTotalWeight(),
          isChronological: profile.isChronological() ? undefined : false,
          isDerived: profile.isDerived() ? true : undefined,
        }).slice(0, -1) + ',"events":[',
      )
      let first = true
      for (const event of profile.getCallEvents()) {
        let frame = frameIndexes.get(event.node.frame)
        if (frame === undefined) {
          frame = frames.length
          frames.push(event.node.frame)
          frameIndexes.set(event.node.frame, frame)
          progress.frameCount++
        }
        // Only fixed tokens and numbers appear here. Symbols and metadata still
        // use JSON.stringify below, including all escaping and Unicode handling.
        const value = Number.isFinite(event.value) ? String(event.value) : 'null'
        write(
          `${first ? '' : ','}{"type":"${event.open ? 'O' : 'C'}","frame":${frame},"at":${value}}`,
        )
        first = false
        if (++progress.eventsWritten % 16384 === 0) await pause()
      }
      write(']}')
      progress.profilesCompleted++
      await pause()
    }
    write('],"shared":{"frames":[')
    for (let index = 0; index < frames.length; index++) {
      const {name, file, line, col, color} = frames[index]
      if (index) write(',')
      write(JSON.stringify({name, file, line, col, color}))
      if (++progress.framesWritten % 4096 === 0) await pause()
    }
    write(']}}')
    flush()
    checkAbort()
    options.onProgress?.({...progress})
    checkAbort()
    return new Blob(parts, {type: 'application/json'})
  } finally {
    channel?.port1.close()
    channel?.port2.close()
  }
}
