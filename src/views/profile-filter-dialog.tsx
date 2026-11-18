import {h} from 'preact'
import {useEffect, useRef, useState} from 'preact/hooks'
import {StyleSheet, css} from 'aphrodite'
import {Profile} from '../lib/profile'
import {filterProfile, ProfileFilterRules} from '../lib/profile-transformations'
import {useTheme, withTheme} from './themes/theme'

interface ProfileFilterDialogProps {
  profile: Profile
  onApply(profile: Profile): void
  onClose(): void
}

export function ProfileFilterDialog(props: ProfileFilterDialogProps) {
  const style = getStyle(useTheme())
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const controller = useRef<AbortController | null>(null)
  const closeCallback = useRef(props.onClose)
  closeCallback.current = props.onClose
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [field, setField] = useState<ProfileFilterRules['field']>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    const cancel = (ev: Event) => {
      ev.preventDefault()
      controller.current?.abort()
      closeCallback.current()
    }
    element.addEventListener('cancel', cancel)
    const stopImport = (ev: Event) => ev.stopPropagation()
    for (const type of ['paste', 'drop', 'dragover']) element.addEventListener(type, stopImport)
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    input.current?.focus()
    return () => {
      controller.current?.abort()
      element.removeEventListener('cancel', cancel)
      for (const type of ['paste', 'drop', 'dragover'])
        element.removeEventListener(type, stopImport)
      previous?.focus()
    }
  }, [])
  const close = () => {
    controller.current?.abort()
    props.onClose()
  }
  const apply = async (ev: Event) => {
    ev.preventDefault()
    if (busy) return
    const operation = new AbortController()
    controller.current = operation
    setBusy(true)
    setError('')
    try {
      const derived = await filterProfile(
        props.profile,
        {
          field,
          include: include.split('\n'),
          exclude: exclude.split('\n'),
        },
        {signal: operation.signal},
      )
      if (operation.signal.aborted) return
      if (!derived.getTotalWeight()) throw new Error('No frames remain. Try different rules.')
      props.onApply(derived)
      props.onClose()
    } catch (e) {
      if (!operation.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!operation.signal.aborted) setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className={css(style.dialog)}
      aria-labelledby="profile-filter-title"
      aria-modal="true"
      onKeyDown={ev => ev.stopPropagation()}
      onKeyPress={ev => ev.stopPropagation()}
    >
      <form onSubmit={apply} className={css(style.form)}>
        <h2 id="profile-filter-title" className={css(style.heading)}>
          Filter frames
        </h2>
        <p className={css(style.source)}>Source: {props.profile.getName()}</p>
        <p className={css(style.text)}>
          Keep only your code, or hide framework frames. Creates a separate aggregate profile; the
          original stays available in the profile selector.
        </p>
        <label className={css(style.label)}>
          Match against
          <select
            className={css(style.control)}
            value={field}
            disabled={busy}
            onChange={ev => setField(ev.currentTarget.value as ProfileFilterRules['field'])}
          >
            <option value="file">Source file path</option>
            <option value="name">Function name</option>
            <option value="either">File path or function name</option>
          </select>
        </label>
        <label className={css(style.label)}>
          Include rules
          <textarea
            className={css(style.control, style.textarea)}
            ref={input}
            rows={3}
            maxLength={4096}
            value={include}
            disabled={busy}
            onInput={ev => setInclude(ev.currentTarget.value)}
            placeholder="src/my-code/"
          />
        </label>
        <label className={css(style.label)}>
          Exclude rules
          <textarea
            className={css(style.control, style.textarea)}
            rows={3}
            maxLength={4096}
            value={exclude}
            disabled={busy}
            onInput={ev => setExclude(ev.currentTarget.value)}
            placeholder="node_modules/"
          />
        </label>
        <p className={css(style.text)}>
          One literal, case-insensitive substring per line; slashes are interchangeable. Any include
          rule can match; exclude rules take priority. Leave include blank to keep all other frames.
        </p>
        <p className={css(style.text)}>
          Hidden leaf frames add self weight to the nearest kept ancestor. Empty stacks and idle
          time are omitted. Percentages use the retained weight, and time order is unavailable.
        </p>
        {busy && <p role="status">Filtering…</p>}
        {error && <p role="alert">{error}</p>}
        <div className={css(style.buttons)}>
          <button type="button" className={css(style.control)} onClick={close}>
            {busy ? 'Cancel filtering' : 'Cancel'}
          </button>
          <button
            type="submit"
            className={css(style.control)}
            disabled={busy || (!include.trim() && !exclude.trim())}
          >
            Create filtered profile
          </button>
        </div>
      </form>
    </dialog>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    dialog: {
      width: 'min(640px, calc(100vw - 32px))',
      maxHeight: '90vh',
      boxSizing: 'border-box',
      overflow: 'auto',
      padding: 20,
      border: `1px solid ${theme.fgSecondaryColor}`,
      borderRadius: 6,
      background: theme.bgPrimaryColor,
      color: theme.fgPrimaryColor,
      font: '14px/1.5 system-ui, sans-serif',
      textAlign: 'left',
      '::backdrop': {background: 'rgba(0, 0, 0, 0.55)'},
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    },
    heading: {margin: 0, fontSize: 20, fontWeight: 600},
    text: {margin: 0},
    source: {margin: 0, overflowWrap: 'anywhere'},
    label: {display: 'flex', flexDirection: 'column', gap: 4},
    control: {
      font: 'inherit',
      color: theme.fgPrimaryColor,
      background: theme.bgSecondaryColor,
      border: `1px solid ${theme.fgSecondaryColor}`,
      padding: 6,
      ':disabled': {opacity: 0.5},
    },
    textarea: {resize: 'vertical'},
    buttons: {display: 'flex', gap: 8, justifyContent: 'flex-end'},
  }),
)
