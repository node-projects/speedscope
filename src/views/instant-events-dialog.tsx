import {h} from 'preact'
import {useEffect, useMemo, useState} from 'preact/hooks'
import {css} from 'aphrodite'
import {InstantTimelineRow, instantEventRange} from '../lib/instant-track-layout'
import {MultiTrackViewport} from '../lib/multi-track-layout'
import {TimeFormatter} from '../lib/value-formatters'
import {useTheme} from './themes/theme'
import {getProfileDialogStyle} from './profile-dialog-style'
import {useModal} from './use-modal'

const PAGE_SIZE = 100
export interface InstantEventsDialogProps {
  row: InstantTimelineRow
  viewport: MultiTrackViewport
  onClose(): void
}

export function InstantEventsDialog(props: InstantEventsDialogProps) {
  const style = getProfileDialogStyle(useTheme())
  const dialog = useModal(props.onClose, () => {})
  const range = useMemo(
    () => instantEventRange(props.row, props.viewport),
    [props.row, props.viewport],
  )
  const [page, setPage] = useState(0),
    [expanded, setExpanded] = useState<number | null>(null)
  const count = range.end - range.first
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const current = Math.max(0, Math.min(pages - 1, page))
  const first = range.first + current * PAGE_SIZE
  const end = Math.min(range.end, first + PAGE_SIZE)
  const format = useMemo(
    () => new TimeFormatter(props.row.instant.timeUnit),
    [props.row.instant.timeUnit],
  )
  const track = props.row.instant
  useEffect(() => {
    setPage(0)
    setExpanded(null)
  }, [props.row, range.first, range.end])
  const changePage = (next: number) => {
    setPage(Math.max(0, Math.min(pages - 1, next)))
    setExpanded(null)
  }
  return (
    <dialog ref={dialog} className={css(style.dialog)} aria-label="Instant event details">
      <h2 className={css(style.heading)}>Instant events: {track.name}</h2>
      <p>
        Scope: {track.scope}
        {track.processId !== undefined ? ` · process ${track.processId}` : ''}
        {track.threadId !== undefined ? ` · thread ${track.threadId}` : ''}. Clock: {track.clock};
        time unit: {track.timeUnit}.
      </p>
      <p>
        Captured visible range: {format.format(props.viewport.left)}–
        {format.format(props.viewport.left + props.viewport.width)} after the shared reference.
        These are zero-duration points, not calls or weights.
      </p>
      <p>
        Recorded metadata is plain text. Stack identifiers in details are unresolved metadata and
        are not converted into call stacks.
      </p>
      <div className={css(style.buttons)}>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
        <button type="button" onClick={() => changePage(current - 1)} disabled={current === 0}>
          Previous page
        </button>
        <label>
          Page{' '}
          <input
            aria-label="Instant event page"
            type="number"
            min={1}
            max={pages}
            value={current + 1}
            onInput={event => {
              const value = event.currentTarget.valueAsNumber
              if (Number.isFinite(value)) changePage(Math.floor(value) - 1)
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => changePage(current + 1)}
          disabled={current + 1 >= pages}
        >
          Next page
        </button>
      </div>
      <p role="status">
        {count
          ? `Events ${first - range.first + 1}–${end - range.first} of ${count}; page ${
              current + 1
            } of ${pages}. Points retain source order, including duplicate timestamps.`
          : 'No instant events in this range.'}
      </p>
      <ol start={first - range.first + 1}>
        {Array.from({length: end - first}, (_, position) => {
          const index = first + position,
            event = track.events[index]
          return (
            <li
              key={index}
              data-instant-event-index={index}
              style={{marginBottom: 12, overflowWrap: 'anywhere'}}
            >
              <strong>{event.name}</strong>
              <div>
                Stored source origin: {track.start} {track.timeUnit}; local offset:{' '}
                {track.times[index]} {track.timeUnit}.
              </div>
              {Number.isFinite(track.start + track.times[index]) && (
                <div>
                  Computed source timestamp (may round): {track.start + track.times[index]}{' '}
                  {track.timeUnit}.
                </div>
              )}
              <div>
                Shared display time: {format.format(props.row.offset + track.times[index])} after
                reference.
              </div>
              {event.category !== undefined && <div>Category: {event.category}</div>}
              {event.details !== undefined && (
                <div>
                  <button
                    type="button"
                    aria-expanded={expanded === index}
                    onClick={() => setExpanded(expanded === index ? null : index)}
                  >
                    {expanded === index ? 'Hide details' : 'Show details'}
                  </button>
                  {expanded === index && (
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {event.details}
                    </pre>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </dialog>
  )
}
