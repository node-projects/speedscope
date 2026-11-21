import {h} from 'preact'
import {useState} from 'preact/hooks'
import {css} from 'aphrodite'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useTheme} from './themes/theme'
import {useModal} from './use-modal'

export function FunctionLinkDialog(props: {url: string; onClose(): void}) {
  const style = getProfileDialogStyle(useTheme())
  const dialog = useModal(props.onClose, () => {})
  const [status, setStatus] = useState('')
  return (
    <dialog
      ref={dialog}
      aria-labelledby="function-link-title"
      aria-modal="true"
      className={css(style.dialog)}
    >
      <div className={css(style.form)}>
        <h2 id="function-link-title" className={css(style.heading)}>
          Link to selected function
        </h2>
        <p className={css(style.text)}>
          This link selects the function in Sandwich after the same recording is opened. It
          identifies the profile and source location; it does not preserve a particular call
          instance, zoom or profile transformation.
        </p>
        <p className={css(style.text)}>
          For a local recording, the recipient must import the same file. An existing HTTP profile
          URL is included; its permissions and network requirements still apply. Review the link
          before sharing: it can contain source paths, function names and URL credentials.
        </p>
        <label className={css(style.label)}>
          Function link
          <textarea
            className={css(style.control)}
            rows={5}
            readOnly
            value={props.url}
            onFocus={e => e.currentTarget.select()}
          />
        </label>
        <div role="status">{status}</div>
        <div className={css(style.buttons)}>
          <button
            type="button"
            className={css(style.control)}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(props.url)
                setStatus('Link copied')
              } catch {
                setStatus('Select the link above and copy it manually.')
              }
            }}
          >
            Copy link
          </button>
          <button type="button" className={css(style.control)} onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  )
}
