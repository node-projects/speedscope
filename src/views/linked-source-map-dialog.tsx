import {h} from 'preact'
import {useRef, useState} from 'preact/hooks'
import {css} from 'aphrodite'
import {Profile, SymbolRemapper} from '../lib/profile'
import {LinkedSourceMapPreview, previewLinkedSourceMap} from '../lib/linked-source-map'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useTheme} from './themes/theme'
import {useModal} from './use-modal'

export function LinkedSourceMapDialog(props: {
  profiles: readonly Profile[]
  initialURL: string
  onClose(): void
  onApply(remapper: SymbolRemapper): void
}) {
  const style = getProfileDialogStyle(useTheme())
  const controller = useRef<AbortController | null>(null)
  const dialog = useModal(props.onClose, () => controller.current?.abort())
  const [url, setURL] = useState(props.initialURL)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<LinkedSourceMapPreview | null>(null)
  const load = async (event: Event) => {
    event.preventDefault()
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setPreview(null)
    setError('')
    try {
      const result = await previewLinkedSourceMap(props.profiles, url, active.signal, message => {
        if (!active.signal.aborted) setStatus(message)
      })
      if (!active.signal.aborted) {
        setPreview(result)
        setStatus('Preview ready. Apply to update the loaded profiles.')
      }
    } catch (failure) {
      if (!active.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure))
      else setStatus('Source-map loading cancelled.')
    } finally {
      if (controller.current === active) {
        controller.current = null
        setBusy(false)
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="linked-source-map-title"
      aria-modal="true"
      className={css(style.dialog)}
    >
      <form onSubmit={load} className={css(style.form)}>
        <h2 id="linked-source-map-title" className={css(style.heading)}>
          Load linked source map
        </h2>
        <p className={css(style.text)}>
          Load the generated JavaScript URL and its linked source map, then review the preview
          before applying it. Nothing is fetched until you choose Load preview.
        </p>
        <p className={css(style.text)}>
          The script URL must match the source location in your recording. Servers must allow
          cross-origin access (CORS). For a local script or map, use Import to open the .map file
          after loading your recording.
        </p>
        <label className={css(style.label)}>
          Generated JavaScript URL
          <input
            type="url"
            required
            className={css(style.control)}
            value={url}
            disabled={busy}
            placeholder="https://example.com/assets/app.js"
            onInput={event => {
              setURL(event.currentTarget.value)
              setPreview(null)
              setError('')
              setStatus('')
            }}
          />
        </label>
        <p role="status" className={css(style.text)}>
          {status}
        </p>
        {error && (
          <p role="alert" className={css(style.source)}>
            {error}
          </p>
        )}
        {preview && (
          <div className={css(style.label)}>
            <p className={css(style.source)}>
              <strong>{preview.changedFrames.toLocaleString()} frames will change.</strong>
            </p>
            <p className={css(style.source)}>Generated script: {preview.generatedURL}</p>
            <p className={css(style.source)}>Linked map: {preview.mapURL}</p>
          </div>
        )}
        <div className={css(style.buttons)}>
          {busy ? (
            <button
              type="button"
              className={css(style.control)}
              onClick={() => controller.current?.abort()}
            >
              Cancel load
            </button>
          ) : (
            <button type="submit" className={css(style.control)}>
              Load preview
            </button>
          )}
          <button
            type="button"
            className={css(style.control)}
            disabled={busy || !preview}
            onClick={() => {
              if (!preview) return
              try {
                props.onApply(preview.remapper)
                props.onClose()
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : String(failure))
              }
            }}
          >
            Apply source map
          </button>
          <button
            type="button"
            className={css(style.control)}
            onClick={() => {
              controller.current?.abort()
              props.onClose()
            }}
          >
            Close
          </button>
        </div>
      </form>
    </dialog>
  )
}
