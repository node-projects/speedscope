import {h} from 'preact'
import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks'
import {css, StyleSheet} from 'aphrodite'
import {Profile} from '../lib/profile'
import {
  buildMultiTrackLayout,
  clampMultiTrackViewport,
  collectTrackTiles,
  MultiTrackViewport,
  MultiTrackGroup,
  TrackTiles,
  TimelineTrack,
  MULTI_TRACK_DEPTH,
  MULTI_TRACK_MAX_TILES,
  multiTrackAxisTicks,
} from '../lib/multi-track-layout'
import {TimeFormatter} from '../lib/value-formatters'
import {frameColorForTheme} from '../lib/frame-color'
import {useTheme, withTheme} from './themes/theme'

export interface MultiTrackViewProps {
  profiles: readonly Profile[]
  selectedProfileIndex: number
  onSelectProfile(index: number): void
}

const ROW_HEIGHT = 158
const HEADER_HEIGHT = 30
const FRAME_HEIGHT = 15
const MAX_VISIBLE_ROWS = 24
const NO_TILES = new Map<number, TrackTiles>()
const short = (name: string) => (name.length > 240 ? name.slice(0, 239) + '…' : name)

export function MultiTrackView(props: MultiTrackViewProps) {
  const theme = useTheme(),
    style = getStyle(theme)
  const layout = useMemo(() => buildMultiTrackLayout(props.profiles), [props.profiles])
  const compatibleCount = useMemo(
    () => layout.groups.reduce((sum, candidate) => sum + candidate.tracks.length, 0),
    [layout],
  )
  const defaultGroup = useMemo(
    () =>
      layout.groups.find(group =>
        group.tracks.some(track => track.profileIndex === props.selectedProfileIndex),
      ) ||
      layout.groups.reduce<(typeof layout.groups)[number] | undefined>(
        (best, group) => (!best || group.tracks.length > best.tracks.length ? group : best),
        undefined,
      ),
    [layout, props.selectedProfileIndex],
  )
  const [groupKey, setGroupKey] = useState('')
  const group = useMemo(
    () => layout.groups.find(candidate => candidate.key === groupKey) || defaultGroup,
    [layout, groupKey, defaultGroup],
  )
  const [requested, setRequested] = useState<MultiTrackViewport>({left: 0, width: Infinity})
  const viewport = useMemo(
    () => (group ? clampMultiTrackViewport(group, requested) : {left: 0, width: 1}),
    [group, requested],
  )
  const scroller = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({width: 800, height: 420})
  const [scrollTop, setScrollTop] = useState(0)
  const [rendered, setRendered] = useState<{
    group?: MultiTrackGroup
    key: string
    rows: Map<number, TrackTiles>
  }>({key: '', rows: NO_TILES})
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('')
  const [crosshair, setCrosshair] = useState<number | null>(null)
  const [hover, setHover] = useState('')
  const drag = useRef<{x: number; left: number} | null>(null)
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT))
  const last = Math.min(
    group?.tracks.length || 0,
    first + Math.min(MAX_VISIBLE_ROWS, Math.ceil(size.height / ROW_HEIGHT) + 1),
  )
  const visible = useMemo(() => group?.tracks.slice(first, last) || [], [group, first, last])
  const requestKey = `${viewport.left},${viewport.width},${first},${last}`
  const data = rendered.group === group && rendered.key === requestKey ? rendered.rows : NO_TILES
  const format = useMemo(() => new TimeFormatter(group?.unit || 'microseconds'), [group?.unit])
  const axis = useMemo(
    () =>
      group ? multiTrackAxisTicks(viewport, size.width, group.unit) : {interval: 0, positions: []},
    [group, viewport, size.width],
  )
  const setViewport = useCallback(
    (next: MultiTrackViewport) => {
      if (group) setRequested(clampMultiTrackViewport(group, next))
    },
    [group],
  )
  const zoom = useCallback(
    (factor: number, anchor = viewport.left + viewport.width / 2) => {
      const width = viewport.width * factor
      setViewport({left: anchor - (anchor - viewport.left) * factor, width})
    },
    [viewport, setViewport],
  )
  useEffect(() => {
    setRequested({left: 0, width: Infinity})
    setScrollTop(0)
    setRendered({key: '', rows: NO_TILES})
    setCrosshair(null)
    if (scroller.current) scroller.current.scrollTop = 0
  }, [group?.key, props.profiles])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      const width = element.clientWidth || bounds.width
      const height = element.clientHeight || bounds.height
      if (width > 0 && height > 0) setSize({width, height})
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [group?.key])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setHover('')
    setRendered({key: '', rows: NO_TILES})
    ;(async () => {
      const next = new Map<number, TrackTiles>()
      const cap = Math.max(1, Math.floor(MULTI_TRACK_MAX_TILES / Math.max(1, visible.length)))
      for (const track of visible)
        next.set(
          track.profileIndex,
          await collectTrackTiles(track, viewport, {signal: controller.signal, maxTiles: cap}),
        )
      if (!controller.signal.aborted) {
        setRendered({group, key: requestKey, rows: next})
        setLoading(false)
      }
    })().catch(failure => {
      if (!controller.signal.aborted) {
        setError(String(failure))
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [group, visible, viewport, requestKey])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (
        !(
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        )
      )
        return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const x = Math.max(
          0,
          Math.min(1, (event.clientX - element.getBoundingClientRect().left) / size.width),
        )
        zoom(
          Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.002))),
          viewport.left + viewport.width * x,
        )
      } else
        setViewport({
          left: viewport.left + ((event.deltaX || event.deltaY) / size.width) * viewport.width,
          width: viewport.width,
        })
    }
    element.addEventListener('wheel', wheel, {passive: false})
    return () => element.removeEventListener('wheel', wheel)
  }, [group, viewport, size.width, setViewport, zoom])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let ctx: CanvasRenderingContext2D | null
    try {
      ctx = element.getContext('2d')
    } catch {
      ctx = null
    }
    if (!ctx) {
      setError('The timeline canvas is unavailable. Open an individual profile instead.')
      return
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    element.width = Math.min(4096, Math.ceil(size.width * ratio))
    element.height = Math.min(2048, Math.ceil(size.height * ratio))
    ctx.setTransform(element.width / size.width, 0, 0, element.height / size.height, 0, 0)
    ctx.fillStyle = theme.bgPrimaryColor
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.font = '11px monospace'
    ctx.textBaseline = 'middle'
    const colors = new Map<string, string>()
    for (let index = first; index < last; index++) {
      const track = group!.tracks[index]
      const top = index * ROW_HEIGHT - scrollTop
      ctx.fillStyle = theme.bgSecondaryColor
      ctx.fillRect(0, top, size.width, HEADER_HEIGHT)
      const tiles = data.get(track.profileIndex)?.tiles || []
      for (const tile of tiles) {
        const left = ((tile.start - viewport.left) / viewport.width) * size.width
        const width = ((tile.end - tile.start) / viewport.width) * size.width
        const y = top + HEADER_HEIGHT + tile.depth * FRAME_HEIGHT
        const frame = tile.node.frame
        const key = frame.color || `name:${frame.name.slice(0, 256)}`
        let color = colors.get(key)
        if (!color) {
          // Stable name coloring without sorting/indexing every profile frame.
          let hash = 0
          for (let character = 0; character < Math.min(256, frame.name.length); character++) {
            hash = (Math.imul(hash, 31) + frame.name.charCodeAt(character)) >>> 0
          }
          color = frame.color
            ? frameColorForTheme(frame.color, theme).toCSS()
            : theme.colorForBucket((hash % 255) / 255).toCSS()
          colors.set(key, color)
        }
        ctx.fillStyle = color
        ctx.fillRect(left, y, width > 2 ? width - 1 : width, FRAME_HEIGHT - 1)
        if (width > 35) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(left + 2, y, Math.max(0, width - 4), FRAME_HEIGHT)
          ctx.clip()
          ctx.fillStyle = theme.fgPrimaryColor
          ctx.fillText(short(frame.name), left + 3, y + FRAME_HEIGHT / 2)
          ctx.restore()
        }
      }
    }
  }, [group, data, first, last, scrollTop, size, viewport.left, viewport.width, theme])

  if (!group)
    return (
      <section className={css(style.section)} aria-label="Synchronized thread timelines">
        <p>
          No aligned thread timelines are available. Profiles need explicit origins in the same
          clock and equal time units.
        </p>
        <p>
          {layout.excluded.length} profiles excluded.{' '}
          {layout.uninspectedCount
            ? `${layout.uninspectedCount} beyond the 10,000-profile inspection limit.`
            : ''}
        </p>
        <ul>
          {layout.excluded.slice(0, 20).map(item => (
            <li key={item.profileIndex}>
              {short(props.profiles[item.profileIndex].getName())}: {item.reason}
            </li>
          ))}
        </ul>
      </section>
    )

  const choices = layout.groups.slice(0, 64)
  if (!choices.includes(group)) choices[choices.length - 1] = group
  const omitted = [...data.values()].reduce((sum, track) => sum + track.omitted, 0)
  const deeper = [...data.values()].some(track => track.deeper)
  const {interval, positions: ticks} = axis
  const other = compatibleCount - group.tracks.length
  const pointer = (event: MouseEvent, trackUnderPointer = true) => {
    const bounds = canvas.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(size.width, event.clientX - bounds.left))
    const time = viewport.left + (x / size.width) * viewport.width
    setCrosshair(time)
    if (drag.current) {
      setViewport({
        left: drag.current.left - ((event.clientX - drag.current.x) / size.width) * viewport.width,
        width: viewport.width,
      })
      return
    }
    if (!trackUnderPointer) return
    const y = event.clientY - bounds.top + scrollTop
    const row = Math.floor(y / ROW_HEIGHT)
    const depth = Math.floor(((y % ROW_HEIGHT) - HEADER_HEIGHT) / FRAME_HEIGHT)
    const track = group.tracks[row]
    const tile =
      track &&
      data
        .get(track.profileIndex)
        ?.tiles.find(
          candidate => candidate.depth === depth && candidate.start <= time && candidate.end > time,
        )
    setHover(
      tile
        ? `${short(tile.node.frame.name)} · visible interval ${format.format(
            tile.start,
          )}–${format.format(tile.end)} after reference`
        : '',
    )
  }
  const activity = (track: TimelineTrack): string => {
    if (crosshair === null) return `Starts +${format.format(track.offset)}`
    if (crosshair < viewport.left || crosshair >= viewport.left + viewport.width)
      return 'Marker outside viewport'
    if (crosshair < track.offset || crosshair >= track.offset + track.profile.getTotalWeight())
      return 'Outside recording'
    const displayed = data.get(track.profileIndex)
    if (!displayed) return loading ? 'Rendering activity…' : 'Activity unavailable'
    let deepest: (typeof displayed.tiles)[number] | undefined
    for (const tile of displayed.tiles) {
      if (
        tile.start <= crosshair &&
        crosshair < tile.end &&
        (!deepest || tile.depth > deepest.depth)
      )
        deepest = tile
    }
    return deepest
      ? `At marker: ${short(deepest.node.frame.name)}`
      : displayed.omitted
        ? 'Detail omitted'
        : 'No recorded call'
  }
  return (
    <section className={css(style.section)} aria-label="Synchronized thread timelines">
      <div className={css(style.controls)}>
        <label>
          Shared clock{' '}
          <select
            aria-label="Shared timeline clock"
            value={group.key}
            onChange={event => setGroupKey(event.currentTarget.value)}
          >
            {choices.map(candidate => (
              <option key={candidate.key} value={candidate.key}>
                {short(candidate.clock)} · {candidate.unit} · {candidate.tracks.length} profiles
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => zoom(0.5)}>
          Zoom in
        </button>
        <button type="button" onClick={() => zoom(2)}>
          Zoom out
        </button>
        <button
          type="button"
          onClick={() =>
            setViewport({left: viewport.left - viewport.width / 4, width: viewport.width})
          }
        >
          Pan earlier
        </button>
        <button
          type="button"
          onClick={() =>
            setViewport({left: viewport.left + viewport.width / 4, width: viewport.width})
          }
        >
          Pan later
        </button>
        <button type="button" onClick={() => setRequested({left: 0, width: Infinity})}>
          Full range
        </button>
      </div>
      <p className={css(style.description)}>
        {group.tracks.length} aligned profiles. Axis is elapsed time after shared reference{' '}
        {group.referenceStart} {group.unit}. First {MULTI_TRACK_DEPTH} stack levels per row; open a
        profile for deeper stacks. Drag to pan; Ctrl/⌘+wheel zooms. Arrow keys pan, +/− zoom, Home
        resets.
      </p>
      <p className={css(style.description)}>
        {layout.excluded.length} unanchored/unsupported profiles excluded; {other} profiles use
        other clocks or units.
        {layout.uninspectedCount
          ? ` ${layout.uninspectedCount} beyond the 10,000-profile inspection limit.`
          : ''}
        {layout.groups.length > 64 ? ' First 64 clock groups are listed.' : ''}
      </p>
      <div className={css(style.axis)} aria-label="Shared timeline axis">
        {ticks.slice(0, 100).map(tick => (
          <span
            className={css(style.tick)}
            key={tick}
            style={{left: `${((tick - viewport.left) / viewport.width) * 100}%`}}
          >
            {format.format(tick, interval)}
          </span>
        ))}
      </div>
      <div
        ref={scroller}
        className={css(style.viewport)}
        tabIndex={0}
        aria-label="Thread timelines; arrows pan, plus and minus zoom"
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setViewport({
              left: viewport.left + (viewport.width / 4) * (event.key === 'ArrowLeft' ? -1 : 1),
              width: viewport.width,
            })
          } else if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            zoom(0.5)
          } else if (event.key === '-') {
            event.preventDefault()
            zoom(2)
          } else if (event.key === 'Home') {
            event.preventDefault()
            setRequested({left: 0, width: Infinity})
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setHover('')
            setCrosshair(
              Math.max(
                viewport.left,
                Math.min(
                  viewport.left + viewport.width,
                  (crosshair ?? viewport.left) +
                    (viewport.width / 100) * (event.key === 'ArrowUp' ? 1 : -1),
                ),
              ),
            )
          }
        }}
      >
        <div
          className={css(style.surface)}
          style={{height: Math.max(size.height, group.tracks.length * ROW_HEIGHT)}}
        >
          <canvas
            ref={canvas}
            className={css(style.canvas)}
            style={{height: size.height}}
            aria-label="Aligned thread activity"
            onMouseMove={pointer}
            onMouseDown={event => {
              event.preventDefault()
              drag.current = {x: event.clientX, left: viewport.left}
              scroller.current?.focus()
            }}
            onMouseUp={() => {
              drag.current = null
            }}
            onMouseLeave={() => {
              drag.current = null
              setHover('')
            }}
          />
          {crosshair !== null &&
            crosshair >= viewport.left &&
            crosshair <= viewport.left + viewport.width && (
              <div
                aria-hidden="true"
                className={css(style.crosshair)}
                style={{
                  left: ((crosshair - viewport.left) / viewport.width) * size.width,
                  top: scrollTop,
                  height: size.height,
                }}
              />
            )}
          {visible.map((track: TimelineTrack, index: number) => (
            <div key={track.profileIndex}>
              <button
                type="button"
                key={track.profileIndex}
                className={css(style.trackLabel)}
                style={{top: (first + index) * ROW_HEIGHT + 4}}
                onClick={() => props.onSelectProfile(track.profileIndex)}
              >
                Open profile: {short(track.profile.getName())}
                {track.profileIndex === props.selectedProfileIndex ? ' (selected)' : ''}
              </button>
              <span className={css(style.activity)} style={{top: (first + index) * ROW_HEIGHT + 8}}>
                {activity(track)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className={css(style.status)} role="status">
        {error ||
          (loading
            ? 'Rendering visible timelines…'
            : omitted
              ? `${omitted.toLocaleString()} additional intervals omitted at the ${MULTI_TRACK_MAX_TILES.toLocaleString()}-rectangle viewport limit. Largest intervals are retained across the viewport; zoom in for detail.`
              : deeper
                ? 'Deeper stacks are available in individual profiles.'
                : 'Visible timelines ready.')}
      </p>
      <p className={css(style.status)} aria-live="off">
        {crosshair === null
          ? 'Point at a time to align activity across all visible rows. Up/Down moves the time marker.'
          : `Shared time marker: ${format.format(crosshair)} after reference.`}{' '}
        {hover}
      </p>
      {layout.excluded.length > 0 && (
        <details>
          <summary>Why profiles were excluded</summary>
          <ul>
            {layout.excluded.slice(0, 20).map(item => (
              <li key={item.profileIndex}>
                {short(props.profiles[item.profileIndex].getName())}: {item.reason}
              </li>
            ))}
          </ul>
          {layout.excluded.length > 20 && <p>First 20 exclusions shown.</p>}
        </details>
      )}
    </section>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    section: {
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      minHeight: 0,
      color: theme.fgPrimaryColor,
      background: theme.bgPrimaryColor,
      padding: 8,
    },
    controls: {display: 'flex', flexWrap: 'wrap', gap: 6},
    description: {fontSize: 12, margin: '6px 0'},
    axis: {
      position: 'relative',
      height: 24,
      minHeight: 24,
      overflow: 'hidden',
      borderBottom: `1px solid ${theme.fgSecondaryColor}`,
      fontSize: 11,
    },
    tick: {position: 'absolute', whiteSpace: 'nowrap'},
    viewport: {
      position: 'relative',
      overflow: 'auto',
      height: 420,
      minHeight: 180,
      maxHeight: 1200,
      flex: '1 1 auto',
      outlineOffset: -2,
    },
    surface: {position: 'relative'},
    canvas: {position: 'sticky', top: 0, display: 'block', width: '100%', cursor: 'crosshair'},
    crosshair: {
      position: 'absolute',
      width: 0,
      borderLeft: `1px solid ${theme.selectionPrimaryColor}`,
      pointerEvents: 'none',
    },
    trackLabel: {
      position: 'absolute',
      left: 4,
      maxWidth: '58%',
      height: 23,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    activity: {
      position: 'absolute',
      left: '60%',
      maxWidth: '38%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: 11,
      pointerEvents: 'none',
    },
    status: {fontSize: 12, margin: '4px 0', minHeight: 16},
  }),
)
