import {h} from 'preact'
import {useMemo, useRef, useState} from 'preact/hooks'
import {css, StyleSheet} from 'aphrodite'
import {Profile} from '../lib/profile'
import {
  compareProfiles,
  ComparisonFrame,
  ComparisonMode,
  ComparisonNode,
  ProfileComparison,
} from '../lib/profile-comparison'
import {importProfileFile, wereSymbolsLoaded} from '../import/profile-loader'
import {isDifferentialFoldedName} from '../import/bg-differential'
import {ProfileComparisonGraph} from './profile-comparison-graph'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useTheme, withTheme} from './themes/theme'
import {useModal} from './use-modal'

const PAGE_SIZE = 100

function ProfileChoice(props: {
  label: string
  profiles: readonly Profile[]
  index: number
  disabled: boolean
  onChange(index: number): void
}) {
  const theme = useTheme()
  const common = getProfileDialogStyle(theme)
  const style = getStyle(theme)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(Math.floor(props.index / PAGE_SIZE))
  const matches = useMemo(() => {
    const indices: number[] = []
    const text = query.toLowerCase()
    props.profiles.forEach((profile, index) => {
      if (profile.getName().toLowerCase().includes(text)) indices.push(index)
    })
    return indices
  }, [props.profiles, query])
  const start = Math.min(
    page * PAGE_SIZE,
    Math.max(0, Math.floor((matches.length - 1) / PAGE_SIZE) * PAGE_SIZE),
  )
  const visible = matches.slice(start, start + PAGE_SIZE)
  return (
    <fieldset disabled={props.disabled} className={css(style.choice)}>
      <legend>{props.label}</legend>
      <label className={css(common.label)}>
        Filter {props.label.toLowerCase()} profiles
        <input
          className={css(common.control, style.choiceControl)}
          value={query}
          maxLength={256}
          onInput={event => {
            setQuery(event.currentTarget.value.slice(0, 256))
            setPage(0)
          }}
        />
      </label>
      <label className={css(common.label)}>
        {props.label} profile
        <select
          className={css(common.control, style.choiceControl)}
          value={props.index}
          onChange={event => props.onChange(Number(event.currentTarget.value))}
        >
          {!visible.includes(props.index) && props.profiles[props.index] && (
            <option value={props.index}>Selected: {props.profiles[props.index].getName()}</option>
          )}
          {visible.map(index => (
            <option key={index} value={index}>
              {index + 1}. {props.profiles[index].getName()}
            </option>
          ))}
        </select>
      </label>
      <div className={css(common.buttons)}>
        <button
          type="button"
          className={css(common.control)}
          disabled={start === 0}
          aria-label={`Previous ${props.label.toLowerCase()} choices`}
          onClick={() => setPage(Math.max(0, Math.floor(start / PAGE_SIZE) - 1))}
        >
          Previous
        </button>
        <span role="status">
          {matches.length
            ? `${start + 1}–${Math.min(start + PAGE_SIZE, matches.length)} of ${matches.length}`
            : 'No matching profiles'}
        </span>
        <button
          type="button"
          className={css(common.control)}
          disabled={start + PAGE_SIZE >= matches.length}
          aria-label={`Next ${props.label.toLowerCase()} choices`}
          onClick={() => setPage(Math.floor(start / PAGE_SIZE) + 1)}
        >
          Next
        </button>
      </div>
    </fieldset>
  )
}

function nodeName(node: ComparisonNode) {
  return node.frame?.name || 'All stacks'
}

export function ProfileComparisonDialog(props: {
  profiles: readonly Profile[]
  initialIndex: number
  onClose(): void
}) {
  const common = getProfileDialogStyle(useTheme())
  const style = getStyle(useTheme())
  const controller = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const differentialInput = useRef<HTMLInputElement>(null)
  const dialog = useModal(props.onClose, () => {
    controller.current?.abort()
    controller.current = null
  })
  const [baselineIndex, setBaselineIndex] = useState(props.initialIndex)
  const [baselineProfiles, setBaselineProfiles] = useState(props.profiles)
  const [candidate, setCandidate] = useState({
    profiles: props.profiles,
    index:
      props.profiles.length > 1
        ? (props.initialIndex + 1) % props.profiles.length
        : props.initialIndex,
    source: 'Loaded recording',
    revision: 0,
  })
  const [mode, setMode] = useState<ComparisonMode>('absolute')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [model, setModel] = useState<ProfileComparison | null>(null)
  const [selected, setSelected] = useState<ComparisonNode | null>(null)
  const [focus, setFocus] = useState<ComparisonNode | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ComparisonNode[] | null>(null)
  const [limited, setLimited] = useState(false)
  const [page, setPage] = useState(0)
  const baseline = baselineProfiles[baselineIndex]
  const candidateProfile = candidate.profiles[candidate.index]
  const clear = () => {
    controller.current?.abort()
    controller.current = null
    setModel(null)
    setSelected(null)
    setFocus(null)
    setResults(null)
    setLimited(false)
    setPage(0)
    setStatus('')
    setError('')
  }
  const run = async (label: string, work: (active: AbortController) => Promise<void>) => {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setBusy(label)
    setError('')
    setStatus(label)
    try {
      await work(active)
      if (active.signal.aborted && controller.current === active)
        setStatus('Cancelled. The loaded recordings are unchanged.')
    } catch (failure) {
      if (controller.current === active) {
        if (active.signal.aborted) setStatus('Cancelled. The loaded recordings are unchanged.')
        else setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (controller.current === active) {
        controller.current = null
        setBusy('')
      }
    }
  }
  const compare = () => {
    if (!baseline || !candidateProfile) return
    setModel(null)
    setSelected(null)
    setFocus(null)
    setResults(null)
    setPage(0)
    setLimited(false)
    void run('Comparing profiles…', async active => {
      const next = await compareProfiles(baseline, candidateProfile, {mode, signal: active.signal})
      if (active.signal.aborted || controller.current !== active) return
      setModel(next)
      setSelected(next.root)
      setFocus(next.root)
      setStatus(`Compared ${next.nodes.length.toLocaleString()} call paths.`)
    })
  }
  const loadCandidate = (file: File) => {
    clear()
    void run('Loading comparison recording…', async active => {
      const group = await importProfileFile(file, {
        signal: active.signal,
        onProgress: progress => {
          if (controller.current === active) setStatus(`${progress.phase}…`)
        },
      })
      if (!group?.profiles.length)
        throw new Error('The comparison recording has no supported profiles.')
      if (!wereSymbolsLoaded(group)) {
        for (const profile of group.profiles) {
          if (active.signal.aborted) return
          await profile.demangle()
        }
      }
      if (active.signal.aborted || controller.current !== active) return
      setCandidate(old => ({
        profiles: group.profiles,
        index: 0,
        source: file.name,
        revision: old.revision + 1,
      }))
      setStatus('Comparison recording loaded. Choose its profile, then compare.')
    })
  }
  const loadDifferential = (file: File) => {
    clear()
    void run('Loading differential folded stacks…', async active => {
      // Explicit selection avoids confusing an ordinary symbol ending in a
      // number with the first of two weight columns. Blob wrapping shares bytes.
      const gzip = /\.gz$/i.test(file.name)
      const named = isDifferentialFoldedName(file.name)
        ? file
        : new File([file], `${file.name}.diff.folded${gzip ? '.gz' : ''}`)
      const group = await importProfileFile(named, {
        signal: active.signal,
        onProgress: progress => {
          if (controller.current === active) setStatus(`${progress.phase}…`)
        },
      })
      if (!group || group.profiles.length !== 2)
        throw new Error('The differential file must contain baseline and candidate weight columns.')
      if (!wereSymbolsLoaded(group)) {
        for (const profile of group.profiles) {
          if (active.signal.aborted) return
          await profile.demangle()
        }
      }
      if (active.signal.aborted || controller.current !== active) return
      group.profiles[0].setName(`${file.name} — Baseline`)
      group.profiles[1].setName(`${file.name} — Candidate`)
      setBaselineProfiles(group.profiles)
      setBaselineIndex(0)
      setCandidate(old => ({
        profiles: group.profiles,
        index: 1,
        source: file.name,
        revision: old.revision + 1,
      }))
      setStatus(
        'Differential folded file loaded: first column is baseline, second is candidate. Click Compare.',
      )
    })
  }
  const search = (event: Event) => {
    event.preventDefault()
    if (!model) return
    const text = query.trim().toLowerCase()
    if (!text) {
      setResults(null)
      setPage(0)
      setLimited(false)
      return
    }
    void run('Searching comparison…', async active => {
      const matches: ComparisonNode[] = []
      const sourceMatches = new Map<ComparisonFrame, boolean>()
      let truncated = false
      for (let index = 0; index < model.nodes.length; index++) {
        if (active.signal.aborted) return
        const node = model.nodes[index]
        let matched = node.frame ? sourceMatches.get(node.frame) : undefined
        if (matched === undefined) {
          matched = !!(
            nodeName(node).toLowerCase().includes(text) ||
            node.frame?.file?.toLowerCase().includes(text)
          )
          if (node.frame) {
            if (sourceMatches.size === 4096) sourceMatches.clear()
            sourceMatches.set(node.frame, matched)
          }
        }
        if (matched) {
          if (matches.length === PAGE_SIZE) {
            truncated = true
            break
          }
          matches.push(node)
        }
        if (index % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (active.signal.aborted || controller.current !== active) return
      setResults(matches)
      setLimited(truncated)
      setPage(0)
      setStatus(
        truncated
          ? 'Showing the first 100 matches. Refine your search.'
          : `${matches.length} matching call paths.`,
      )
    })
  }
  const format = (value: number) =>
    model?.mode === 'normalized'
      ? `${(value * 100).toFixed(2)}%`
      : baseline?.formatValue(value) || String(value)
  const delta = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '-' : ''}${
      model?.mode === 'normalized'
        ? `${(Math.abs(value) * 100).toFixed(2)} pp`
        : format(Math.abs(value))
    }`
  const rows = results || model?.nodes || []
  const path: ComparisonNode[] = []
  let ancestor = focus?.parent
  while (ancestor && path.length < 16) {
    path.push(ancestor)
    ancestor = ancestor.parent
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="profile-comparison-title"
      aria-modal="true"
      className={css(common.dialog, style.dialog)}
    >
      <div className={css(common.form)}>
        <header className={css(style.header)}>
          <h2 id="profile-comparison-title" className={css(common.heading)}>
            Compare profiles
          </h2>
          <button type="button" className={css(common.control)} onClick={props.onClose}>
            Close comparison
          </button>
        </header>
        <p className={css(common.text)}>
          Compare call paths by source identity. Positive differences are increases; negative
          differences are decreases. Both recordings and a bounded comparison model stay in memory
          while this dialog is open.
        </p>
        <details open={!model}>
          <summary className={css(style.summary)}>Profiles and scaling</summary>
          <div className={css(common.form)}>
            <div className={css(style.columns)}>
              <ProfileChoice
                label="Baseline"
                profiles={baselineProfiles}
                index={baselineIndex}
                disabled={!!busy}
                onChange={index => {
                  clear()
                  setBaselineIndex(index)
                }}
              />
              <ProfileChoice
                key={`candidate-${candidate.revision}`}
                label="Candidate"
                profiles={candidate.profiles}
                index={candidate.index}
                disabled={!!busy}
                onChange={index => {
                  clear()
                  setCandidate(old => ({...old, index}))
                }}
              />
            </div>
            <p className={css(common.source)}>Candidate recording: {candidate.source}</p>
            <input
              ref={differentialInput}
              type="file"
              hidden
              aria-label="Differential folded file"
              onChange={event => {
                const file = event.currentTarget.files?.item(0)
                event.currentTarget.value = ''
                if (file) loadDifferential(file)
              }}
            />
            <input
              ref={input}
              type="file"
              hidden
              onChange={event => {
                const file = event.currentTarget.files?.item(0)
                event.currentTarget.value = ''
                if (file) loadCandidate(file)
              }}
            />
            <div className={css(style.controls)}>
              <button
                type="button"
                className={css(common.control)}
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                Open comparison recording…
              </button>
              <button
                type="button"
                className={css(common.control)}
                disabled={!!busy}
                onClick={() => differentialInput.current?.click()}
              >
                Open differential folded…
              </button>
              {(candidate.profiles !== props.profiles || baselineProfiles !== props.profiles) && (
                <button
                  type="button"
                  className={css(common.control)}
                  disabled={!!busy}
                  onClick={() => {
                    clear()
                    setBaselineProfiles(props.profiles)
                    setBaselineIndex(props.initialIndex)
                    setCandidate(old => ({
                      profiles: props.profiles,
                      index: props.initialIndex,
                      source: 'Loaded recording',
                      revision: old.revision + 1,
                    }))
                  }}
                >
                  Use loaded recording
                </button>
              )}
              <label className={css(common.label)}>
                Scaling
                <select
                  className={css(common.control)}
                  value={mode}
                  disabled={!!busy}
                  onChange={event => {
                    clear()
                    setMode(event.currentTarget.value as ComparisonMode)
                  }}
                >
                  <option value="absolute">Absolute weights (same units)</option>
                  <option value="normalized">Share of each profile total</option>
                </select>
              </label>
              <button
                type="button"
                className={css(common.control)}
                disabled={!!busy || !baseline || !candidateProfile}
                onClick={compare}
              >
                Compare
              </button>
            </div>
            <p className={css(common.text)}>
              {mode === 'normalized'
                ? 'Each side is divided by its own profile total, including idle weight. Differences are percentage points. Different units compare composition only, not absolute performance.'
                : 'Absolute comparison requires identical units. Values are candidate minus baseline; no duration or rate rescaling is applied.'}
            </p>
          </div>
        </details>
        {busy && (
          <button
            type="button"
            className={css(common.control)}
            onClick={() => controller.current?.abort()}
          >
            Cancel work
          </button>
        )}
        {baseline && candidateProfile && (
          <p className={css(common.text)}>
            Baseline: {baseline.formatValue(baseline.getTotalWeight())} ({baseline.getWeightUnit()}
            ); candidate: {candidateProfile.formatValue(candidateProfile.getTotalWeight())} (
            {candidateProfile.getWeightUnit()}).
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <p role="status">{status}</p>
        {model && focus && (
          <section aria-label="Comparison results" className={css(common.form)}>
            <p className={css(common.text)}>
              Red: increase. Blue: decrease. Neutral: unchanged. Width is the union of
              baseline/candidate self weights along each call path; it is not elapsed time.
              Double-click a tile or use Zoom to selected to inspect a subtree.
            </p>
            <div className={css(style.controls)}>
              <button
                type="button"
                className={css(common.control)}
                onClick={() => setFocus(model.root)}
              >
                All stacks
              </button>
              {path
                .reverse()
                .filter(node => node !== model.root)
                .map(node => (
                  <button
                    type="button"
                    className={css(common.control)}
                    key={node.id}
                    onClick={() => setFocus(node)}
                  >
                    {nodeName(node)}
                  </button>
                ))}
              {ancestor && <span>Earlier ancestors omitted; use All stacks to reset.</span>}
              <button
                type="button"
                className={css(common.control)}
                disabled={!selected}
                onClick={() => selected && setFocus(selected)}
              >
                Zoom to selected
              </button>
              <button
                type="button"
                className={css(common.control)}
                disabled={!focus.parent}
                onClick={() => focus.parent && setFocus(focus.parent)}
              >
                Parent call path
              </button>
            </div>
            <ProfileComparisonGraph
              model={model}
              focusNode={focus}
              selectedNode={selected}
              onSelect={setSelected}
              onDrill={setFocus}
            />
            {selected && (
              <section aria-label="Selected comparison call path" className={css(style.details)}>
                <strong>{nodeName(selected)}</strong>
                <div>
                  {selected.frame?.file}
                  {selected.frame?.line ? `:${selected.frame.line}` : ''}
                  {selected.frame?.col ? `:${selected.frame.col}` : ''}
                </div>
                <div>Caller: {selected.parent ? nodeName(selected.parent) : 'None'}</div>
                <div>
                  Baseline total {format(selected.baselineTotal)}; candidate total{' '}
                  {format(selected.candidateTotal)}; total difference {delta(selected.totalDelta)}.
                </div>
                <div>
                  Baseline self {format(selected.baselineSelf)}; candidate self{' '}
                  {format(selected.candidateSelf)}; self difference {delta(selected.selfDelta)}.
                </div>
              </section>
            )}
            <form onSubmit={search} className={css(style.controls)}>
              <label className={css(common.label)}>
                Find a comparison call path
                <input
                  className={css(common.control)}
                  value={query}
                  maxLength={256}
                  disabled={!!busy}
                  onInput={event => setQuery(event.currentTarget.value.slice(0, 256))}
                />
              </label>
              <button type="submit" className={css(common.control)} disabled={!!busy}>
                Search comparison
              </button>
            </form>
            {limited && <p>Only the first 100 matches are shown. Refine the query.</p>}
            <div className={css(style.tableScroll)}>
              <table className={css(style.table)} aria-label="Comparison call paths">
                <thead>
                  <tr>
                    <th>Function / call path</th>
                    <th>Baseline total</th>
                    <th>Candidate total</th>
                    <th>Total difference</th>
                    <th>Self difference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(node => (
                    <tr key={node.id}>
                      <td>
                        <button
                          type="button"
                          className={css(common.control)}
                          onClick={() => {
                            setSelected(node)
                            setFocus(node.parent || model.root)
                          }}
                        >
                          {nodeName(node)}
                        </button>
                        <div>{node.parent ? `Caller: ${nodeName(node.parent)}` : ''}</div>
                      </td>
                      <td>{format(node.baselineTotal)}</td>
                      <td>{format(node.candidateTotal)}</td>
                      <td>{delta(node.totalDelta)}</td>
                      <td>{delta(node.selfDelta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={css(style.controls)}>
              <button
                type="button"
                className={css(common.control)}
                disabled={page === 0}
                onClick={() => setPage(value => value - 1)}
              >
                Previous call paths
              </button>
              <span>
                {rows.length
                  ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, rows.length)} of ${
                      rows.length
                    }`
                  : 'No matching call paths'}
              </span>
              <button
                type="button"
                className={css(common.control)}
                disabled={(page + 1) * PAGE_SIZE >= rows.length}
                onClick={() => setPage(value => value + 1)}
              >
                Next call paths
              </button>
            </div>
          </section>
        )}
      </div>
    </dialog>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    dialog: {width: 'min(1100px, calc(100vw - 32px))'},
    summary: {cursor: 'pointer', fontWeight: 600, padding: '6px 0'},
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      position: 'sticky',
      top: 0,
      background: theme.bgPrimaryColor,
      paddingBottom: 8,
      zIndex: 2,
    },
    columns: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
      gap: 12,
    },
    controls: {display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap'},
    choice: {minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8},
    choiceControl: {minWidth: 0, maxWidth: '100%', width: '100%', boxSizing: 'border-box'},
    details: {
      padding: 10,
      background: theme.bgSecondaryColor,
      overflowWrap: 'anywhere',
      maxHeight: 240,
      overflow: 'auto',
    },
    tableScroll: {overflowX: 'auto'},
    table: {width: '100%', borderCollapse: 'collapse', textAlign: 'left', lineHeight: 1.6},
  }),
)
