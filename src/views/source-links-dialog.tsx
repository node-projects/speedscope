import {h} from 'preact'
import {useState} from 'preact/hooks'
import {css} from 'aphrodite'
import {FrameInfo} from '../lib/profile'
import {defaultSourceLinkConfig, sourceLink, validateSourceLinkConfig} from '../lib/source-links'
import {sourceLinkConfigAtom} from '../app-state/display-preferences'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useTheme} from './themes/theme'
import {useModal} from './use-modal'

export function SourceLinksDialog(props: {sample: FrameInfo | null; onClose(): void}) {
  const style = getProfileDialogStyle(useTheme())
  const dialog = useModal(props.onClose, () => {})
  const [config, setConfig] = useState(
    () => sourceLinkConfigAtom.get() || {...defaultSourceLinkConfig},
  )
  const [path, setPath] = useState(() => (props.sample?.file || 'src/example.ts').slice(0, 4096))
  const [error, setError] = useState('')
  const preview = sourceLink({file: path, line: props.sample?.line, col: props.sample?.col}, config)
  const save = (event: Event) => {
    event.preventDefault()
    try {
      sourceLinkConfigAtom.set(validateSourceLinkConfig(config))
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="source-links-title"
      aria-modal="true"
      className={css(style.dialog)}
    >
      <form onSubmit={save} className={css(style.form)}>
        <h2 id="source-links-title" className={css(style.heading)}>
          Source-code links
        </h2>
        <p className={css(style.text)}>
          Turn source locations into links in Call Tree and selected-stack details. Links open only
          when clicked. Settings stay in this browser and are not exported with profiles.
        </p>
        <label className={css(style.label)}>
          Open source in
          <select
            className={css(style.control)}
            value={config.editor}
            onChange={event =>
              setConfig({...config, editor: event.currentTarget.value as typeof config.editor})
            }
          >
            <option value="vscode">Visual Studio Code</option>
            <option value="vscode-insiders">Visual Studio Code Insiders</option>
            <option value="web">Custom web URL</option>
          </select>
        </label>
        {config.editor === 'web' && (
          <label className={css(style.label)}>
            Web URL template
            <input
              className={css(style.control)}
              value={config.template}
              maxLength={2048}
              onInput={event => setConfig({...config, template: event.currentTarget.value})}
            />
            <span>
              Use {'{file}'}, {'{line}'} and {'{column}'}. The host must be fixed.
            </span>
          </label>
        )}
        <label className={css(style.label)}>
          Recorded path prefix
          <input
            className={css(style.control)}
            value={config.fromPrefix}
            maxLength={4096}
            placeholder="/build/project/"
            onInput={event => setConfig({...config, fromPrefix: event.currentTarget.value})}
          />
        </label>
        <label className={css(style.label)}>
          Replacement path prefix
          <input
            className={css(style.control)}
            value={config.toPrefix}
            maxLength={4096}
            placeholder="C:/work/project/"
            onInput={event => setConfig({...config, toPrefix: event.currentTarget.value})}
          />
        </label>
        <p className={css(style.text)}>
          Mapping replaces a complete leading path segment. Leave both prefixes empty to keep the
          recorded path. VS Code needs an absolute local path; web templates can use
          repository-relative paths.
        </p>
        <label className={css(style.label)}>
          Preview source path
          <input
            className={css(style.control)}
            value={path}
            maxLength={4096}
            onInput={event => setPath(event.currentTarget.value)}
          />
        </label>
        <p role="status" className={css(style.source)}>
          {preview
            ? `Preview: ${preview}`
            : 'Preview unavailable: check the template, path mapping or absolute local path.'}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={css(style.buttons)}>
          <button className={css(style.control)} type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className={css(style.control)}
            type="button"
            onClick={() => {
              sourceLinkConfigAtom.set(null)
              props.onClose()
            }}
          >
            Disable links
          </button>
          <button className={css(style.control)} type="submit">
            Save source links
          </button>
        </div>
      </form>
    </dialog>
  )
}
