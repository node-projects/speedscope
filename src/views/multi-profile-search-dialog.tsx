import {h} from 'preact'
import {useRef, useState} from 'preact/hooks'
import {StyleSheet, css} from 'aphrodite'
import {Profile} from '../lib/profile'
import {
  searchProfiles,
  MultiProfileSearchResult,
  ProfileSearchMatch,
} from '../lib/multi-profile-search'
import {SearchMode} from '../lib/profile-search'
import {useTheme, withTheme} from './themes/theme'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useModal} from './use-modal'

export function MultiProfileSearchDialog(props: {
  profiles: readonly Profile[]
  onSelect(match: ProfileSearchMatch, query: string, mode: SearchMode): void
  onClose(): void
}) {
  const theme = useTheme()
  const common = getProfileDialogStyle(theme)
  const style = getStyle(theme)
  const controller = useRef<AbortController | null>(null)
  const dialog = useModal(props.onClose, () => controller.current?.abort())
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState(SearchMode.SUBSTRING)
  const [includeDerived, setIncludeDerived] = useState(false)
  const [response, setResponse] = useState<MultiProfileSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelSearch = () => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
  }
  const submit = async (event: Event) => {
    event.preventDefault()
    if (busy || !query.trim()) return
    const operation = new AbortController()
    controller.current = operation
    setBusy(true)
    setError('')
    setResponse(null)
    try {
      const result = await searchProfiles(props.profiles, query, {
        mode,
        includeDerived,
        signal: operation.signal,
      })
      if (controller.current === operation && !operation.signal.aborted) setResponse(result)
    } catch (e) {
      if (!operation.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (controller.current === operation) {
        controller.current = null
        setBusy(false)
      }
    }
  }
  const open = (match: ProfileSearchMatch) => {
    try {
      props.onSelect(match, query, mode)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const short = (text: string, limit = 160) =>
    text.length > limit ? text.slice(0, limit - 1) + '…' : text
  return (
    <dialog
      ref={dialog}
      aria-labelledby="multi-search-title"
      aria-modal="true"
      className={css(common.dialog, style.dialog)}
    >
      <form className={css(common.form)} onSubmit={submit}>
        <h2 id="multi-search-title" className={css(common.heading)}>
          Search all profiles
        </h2>
        <p className={css(common.text)}>
          Find a function or source file across threads. Open a result in Sandwich to inspect its
          callers and callees in the original profile.
        </p>
        <label className={css(common.label)}>
          Function or source path
          <input
            className={css(common.control)}
            value={query}
            maxLength={4096}
            disabled={busy}
            onInput={event => {
              setQuery(event.currentTarget.value)
              setResponse(null)
            }}
          />
        </label>
        <label className={css(common.label)}>
          Match mode
          <select
            className={css(common.control)}
            value={mode}
            disabled={busy}
            onChange={event => {
              setMode(event.currentTarget.value as SearchMode)
              setResponse(null)
            }}
          >
            <option value={SearchMode.SUBSTRING}>Contains</option>
            <option value={SearchMode.WHOLE_WORD}>Whole word</option>
            <option value={SearchMode.EXACT}>Exact</option>
            <option value={SearchMode.REGEX}>Regex (RE2)</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeDerived}
            disabled={busy}
            onChange={event => {
              setIncludeDerived(event.currentTarget.checked)
              setResponse(null)
            }}
          />{' '}
          Include derived profiles
        </label>
        <p className={css(common.text)}>
          One result per frame in each profile. Total and self values use that profile’s own units;
          weights are not combined.
        </p>
        {busy && <p role="status">Searching profiles…</p>}
        {error && <p role="alert">{error}</p>}
        {response && (
          <div>
            <p role="status">
              {response.matches.length
                ? `${response.matches.length} matching frames`
                : 'No matches found.'}
              {response.truncated &&
                ' — Showing the first 200 matches. Narrow your search to see others.'}
            </p>
            {!!response.matches.length && (
              <div className={css(style.results)}>
                <table className={css(style.table)}>
                  <thead>
                    <tr>
                      <th>Profile</th>
                      <th>Function / source</th>
                      <th>Total</th>
                      <th>Self</th>
                    </tr>
                  </thead>
                  <tbody>
                    {response.matches.map(match => (
                      <tr>
                        <td
                          className={css(style.cell)}
                          title={short(match.profile.getName(), 2048)}
                        >
                          #{match.profileIndex + 1} {short(match.profile.getName())}
                        </td>
                        <td className={css(style.cell)}>
                          <button
                            type="button"
                            className={css(common.control, style.resultButton)}
                            aria-label={`Open ${short(match.frame.name)} in ${short(
                              match.profile.getName(),
                            )}`}
                            title={short(match.frame.name, 2048)}
                            onClick={() => open(match)}
                          >
                            {short(match.frame.name)}
                          </button>
                          {match.frame.file && (
                            <div title={short(match.frame.file, 2048)}>
                              {short(match.frame.file, 240)}
                              {match.frame.line != null && `:${match.frame.line}`}
                              {match.frame.col != null && `:${match.frame.col}`}
                            </div>
                          )}
                        </td>
                        <td className={css(style.cell)}>
                          {match.profile.formatValue(match.frame.getTotalWeight())}
                        </td>
                        <td className={css(style.cell)}>
                          {match.profile.formatValue(match.frame.getSelfWeight())}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className={css(common.buttons)}>
          <button
            className={css(common.control)}
            type="button"
            onClick={() => {
              cancelSearch()
              props.onClose()
            }}
          >
            Close
          </button>
          {busy ? (
            <button className={css(common.control)} type="button" onClick={cancelSearch}>
              Cancel search
            </button>
          ) : (
            <button className={css(common.control)} type="submit" disabled={!query.trim()}>
              Search
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}
const getStyle = withTheme(theme =>
  StyleSheet.create({
    dialog: {width: 'min(1000px, calc(100vw - 32px))'},
    results: {maxHeight: '40vh', overflow: 'auto'},
    table: {width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left'},
    cell: {padding: 6, borderTop: `1px solid ${theme.fgSecondaryColor}`, overflowWrap: 'anywhere'},
    resultButton: {textAlign: 'left', cursor: 'pointer', width: '100%', overflowWrap: 'anywhere'},
  }),
)
