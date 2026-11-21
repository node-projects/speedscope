import {h, Fragment, ComponentChildren} from 'preact'
import {useState} from 'preact/hooks'
import {css, StyleSheet} from 'aphrodite'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useTheme, withTheme} from './themes/theme'
import {useModal} from './use-modal'

function HelpDialog(props: {onClose(): void}) {
  const theme = useTheme()
  const common = getProfileDialogStyle(theme)
  const style = getStyle(theme)
  const dialog = useModal(props.onClose, () => {})
  return (
    <dialog
      ref={dialog}
      aria-labelledby="help-title"
      aria-modal="true"
      className={css(common.dialog, style.dialog)}
    >
      <header className={css(style.header)}>
        <div>
          <h2 id="help-title" className={css(style.title)}>
            Help with speedscope
          </h2>
          <p className={css(style.subtitle)}>A guide to exploring your recordings.</p>
        </div>
        <button type="button" className={css(common.control, style.close)} onClick={props.onClose}>
          Close help
        </button>
      </header>
      <div className={css(style.grid)}>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Open a recording</h3>
          <p>
            Use Import or Browse, or drop a profile file onto the app. Choose a thread or profile by
            clicking the profile selector. Its chooser stays open while you filter, use arrow keys
            or select a row. Export saves a speedscope JSON file you can reopen later.
          </p>
          <p>
            Supported formats include speedscope JSON, Chrome and Firefox profiles, duration traces
            (plain or gzip), perf, pprof, collapsed stacks, Java Flight Recorder, classic Android
            method traces, current OTLP Profiles JSON and traditional Java thread dumps. Java dumps
            can be plain text or a bounded ZIP of snapshots from one JVM. Extract unsupported
            archive variants first. Java dumps count observed stacks, rather than elapsed time.
          </p>
          <p>
            Native cProfile files show flat self time and immediate callers, without inventing full
            stacks. Signed pprof heap deltas show separate negative magnitudes and positive
            contributions; compare positive minus negative in absolute mode for the net change.
          </p>
        </section>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Choose a view</h3>
          <ul className={css(style.list)}>
            <li>
              <strong>Time Order:</strong> inspect calls along the recording timeline. Aggregate
              profiles have no chronological order, so this view is unavailable for them.
            </li>
            <li>
              <strong>Left Heavy:</strong> group matching stacks and put the heaviest paths first.
            </li>
            <li>
              <strong>Sandwich:</strong> select a function to explore its callers and callees.
              Resize the panes with their dividers.
            </li>
            <li>
              <strong>Call Tree:</strong> expand stacks in a keyboard-accessible table.
            </li>
            <li>
              <strong>Tracks:</strong> align chronological threads sharing an explicit clock. Pan
              and zoom all rows together, or move the time marker to correlate activity. Open a
              profile for deeper stacks. Profiles without a shared origin are excluded with reasons.
            </li>
          </ul>
          <p>
            Click a graph frame to see its details. Function selection follows you between Time
            Order, Left Heavy and Sandwich; each view keeps its own call instance and zoom.
          </p>
        </section>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Navigate and search</h3>
          <p>
            Drag or scroll a graph to pan; hold Ctrl or ⌘ while scrolling to zoom. The overview
            outlines the visible range: drag it to move through the recording, or focus it and use
            arrow keys to pan, plus/minus to zoom, and Home to reset.
          </p>
          <p>
            Use the search field to find function names or source paths. Contains, Whole word and
            Exact matching help narrow results. Profile actions → Search all profiles searches
            across threads. Very large result sets are capped; refine your query to see more
            relevant matches.
          </p>
          <p>
            Regex (RE2) matches full names and paths with a bounded, linear-time engine. Enter a
            pattern without slash delimiters. Backreferences and lookaround are unsupported; invalid
            or excessive patterns show an error. Literal modes remain available.
          </p>
        </section>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Keyboard shortcuts</h3>
          <dl className={css(style.shortcuts)}>
            {[
              ['1 / 2 / 3 / 4 / 5', 'Switch between views'],
              ['r', 'Toggle recursion flattening'],
              ['n / p', 'Next / previous profile'],
              ['Ctrl/⌘ O', 'Import a recording'],
              ['Ctrl/⌘ S', 'Export the profile group'],
              ['Esc', 'Close help'],
            ].map(([keys, action]) => (
              <Fragment key={keys}>
                <dt>
                  <kbd className={css(style.key)}>{keys}</kbd>
                </dt>
                <dd className={css(style.shortcutDescription)}>{action}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Statistics and profile actions</h3>
          <p>
            Total includes callees; Self measures work in the function itself. This Instance
            describes the selected stack context; All Instances describes the function across the
            profile. Values use the recording's units. Open About these statistics in stack details
            for the percentage denominators.
          </p>
          <p>
            Profile actions can crop the current time view, combine original profiles, invert
            stacks, group by file or filter frames. These create derived profiles and keep the
            originals available. Source-code links and compact path labels are also configurable
            there.
          </p>
          <p>
            Link to selected function creates a bookmark that opens the function in Sandwich. Share
            the original recording separately for local files; the link does not include the
            recording or a particular call instance.
          </p>
          <p>
            Compare profiles opens a baseline/candidate comparison, optionally with another local
            recording. Red shows increases and blue decreases; select a tile for total and self
            changes, then zoom into its call path. Absolute mode requires matching units; normalized
            mode compares shares of each recording. Both recordings stay in memory until you close
            the comparison. The graph and paged table have explicit resource limits.
          </p>
          <p>
            Open differential folded in the comparison dialog reads two weight columns: baseline,
            then candidate. It preserves both sides and the main recording. Ordinary folded import
            keeps its single-column meaning, including numeric symbol names.
          </p>
        </section>
        <section className={css(style.card)}>
          <h3 className={css(style.sectionTitle)}>Large files and offline use</h3>
          <p>
            Large supported traces import in the background with progress and cancellation. Duration
            traces stream their input, but the resulting profile still needs memory. If a capture
            exceeds the import limits, reduce it at the recording source or split it into smaller
            recordings.
          </p>
          <p>
            Local recordings are processed in your browser. After the hosted app finishes its first
            online installation, you can reopen it offline and import a local file again. Remote
            profile links and the built-in example still need a network connection. Close all app
            tabs and reopen to adopt a downloaded app update.
          </p>
        </section>
      </div>
    </dialog>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    dialog: {
      width: 'min(960px, calc(100vw - 32px))',
      padding: 0,
      borderRadius: 12,
      boxShadow: '0 20px 80px rgba(0, 0, 0, 0.35)',
    },
    header: {
      position: 'sticky',
      top: 0,
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '20px 24px',
      background: theme.bgPrimaryColor,
      borderBottom: `1px solid ${theme.fgSecondaryColor}`,
      '@media (max-width: 600px)': {padding: 16, alignItems: 'flex-start'},
    },
    title: {fontSize: 22, fontWeight: 600, lineHeight: 1.25, margin: 0},
    subtitle: {marginTop: 6, color: theme.fgSecondaryColor, fontSize: 13},
    close: {flexShrink: 0, borderRadius: 6, padding: '7px 12px', cursor: 'pointer'},
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      alignItems: 'flex-start',
      gap: 16,
      padding: 24,
      '@media (max-width: 700px)': {gridTemplateColumns: 'minmax(0, 1fr)', padding: 16},
    },
    card: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: 20,
      borderRadius: 8,
      background: theme.bgSecondaryColor,
    },
    sectionTitle: {fontSize: 16, fontWeight: 600, margin: 0, lineHeight: 1.4},
    list: {paddingLeft: 18, listStyleType: 'disc', display: 'grid', gap: 10},
    shortcuts: {
      display: 'grid',
      gridTemplateColumns: 'max-content minmax(0, 1fr)',
      alignItems: 'center',
      gap: '14px 16px',
    },
    key: {
      display: 'inline-block',
      padding: '3px 7px',
      borderRadius: 4,
      border: `1px solid ${theme.fgSecondaryColor}`,
      background: theme.bgPrimaryColor,
      font: '12px/1.5 monospace',
      whiteSpace: 'nowrap',
    },
    shortcutDescription: {margin: 0},
  }),
)

export function HelpButton(props: {className?: string; children?: ComponentChildren}) {
  const [shown, setShown] = useState(false)
  return (
    <Fragment>
      <button
        type="button"
        className={props.className}
        aria-haspopup="dialog"
        onClick={() => setShown(true)}
      >
        {props.children || 'Help'}
      </button>
      {shown && <HelpDialog onClose={() => setShown(false)} />}
    </Fragment>
  )
}
