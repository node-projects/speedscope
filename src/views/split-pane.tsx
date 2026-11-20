import {h, ComponentChildren} from 'preact'
import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks'
import {StyleSheet, css} from 'aphrodite'
import {useTheme, withTheme} from './themes/theme'

export function clampSplitFraction(value: number, extent = 0, minimumSize = 0) {
  const minimum = extent > 0 ? Math.min(0.5, Math.max(0.15, minimumSize / extent)) : 0.15
  return Math.max(minimum, Math.min(1 - minimum, Number.isFinite(value) ? value : 0.5))
}
export function readSplitFraction(key: string) {
  try {
    const value = window.localStorage.getItem(key)
    return value === null || !value.trim() ? 0.5 : clampSplitFraction(Number(value))
  } catch {
    return 0.5
  }
}

export function SplitPane(props: {
  direction: 'row' | 'column'
  storageKey: string
  label: string
  minimumSize: number
  first: ComponentChildren
  second: ComponentChildren
}) {
  const style = getStyle(useTheme())
  const root = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const [fraction, setFraction] = useState(() => readSplitFraction(props.storageKey))
  const latestFraction = useRef(fraction)
  const [extent, setExtent] = useState(0)
  const row = props.direction === 'row'
  const effective = clampSplitFraction(fraction, extent, props.minimumSize)
  const persist = (value: number) => {
    try {
      window.localStorage.setItem(props.storageKey, String(value))
    } catch {}
  }
  const update = (value: number, save: boolean, available = extent) => {
    const next = clampSplitFraction(value, available, props.minimumSize)
    latestFraction.current = next
    setFraction(next)
    if (save) persist(next)
  }
  useEffect(() => {
    const element = root.current!
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      setExtent(Math.max(0, (row ? bounds.width : bounds.height) - 6))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [row])
  useLayoutEffect(() => {
    // Graph canvases share a renderer and listen for resize to update viewports.
    window.dispatchEvent(new Event('resize'))
  }, [effective])
  return (
    <div ref={root} className={css(style.root)} style={{flexDirection: props.direction}}>
      <div
        className={css(style.pane)}
        style={{flex: `0 0 calc(${effective * 100}% - ${effective * 6}px)`}}
      >
        {props.first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={props.label}
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(clampSplitFraction(0, extent, props.minimumSize) * 100)}
        aria-valuemax={Math.round(clampSplitFraction(1, extent, props.minimumSize) * 100)}
        aria-valuenow={Math.round(effective * 100)}
        title="Drag or use arrow keys to resize. Home/End move to the limits. Enter or double-click resets."
        className={css(style.divider, row ? style.vertical : style.horizontal)}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          dragging.current = event.pointerId
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={event => {
          if (dragging.current !== event.pointerId) return
          const bounds = root.current!.getBoundingClientRect()
          const available = Math.max(1, (row ? bounds.width : bounds.height) - 6)
          const position = row ? event.clientX - bounds.left : event.clientY - bounds.top
          update((position - 3) / available, false, available)
        }}
        onPointerUp={event => {
          if (dragging.current !== event.pointerId) return
          dragging.current = null
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          persist(latestFraction.current)
        }}
        onPointerCancel={() => {
          dragging.current = null
        }}
        onDblClick={() => update(0.5, true)}
        onKeyDown={event => {
          const decrement = row ? 'ArrowLeft' : 'ArrowUp'
          const increment = row ? 'ArrowRight' : 'ArrowDown'
          let next: number
          if (event.key === decrement) next = effective - (event.shiftKey ? 0.1 : 0.02)
          else if (event.key === increment) next = effective + (event.shiftKey ? 0.1 : 0.02)
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = 1
          else if (event.key === 'Enter') next = 0.5
          else return
          event.stopPropagation()
          event.preventDefault()
          update(next, true)
        }}
      >
        <span aria-hidden="true">{row ? '⋮' : '⋯'}</span>
      </div>
      <div className={css(style.pane, style.remainder)}>{props.second}</div>
    </div>
  )
}
const getStyle = withTheme(theme =>
  StyleSheet.create({
    root: {display: 'flex', flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0},
    pane: {display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden'},
    remainder: {flex: 1},
    divider: {
      flex: '0 0 6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      userSelect: 'none',
      touchAction: 'none',
      color: theme.fgSecondaryColor,
      background: theme.bgSecondaryColor,
      ':hover': {background: theme.selectionSecondaryColor},
      ':focus-visible': {outline: `2px solid ${theme.fgPrimaryColor}`, outlineOffset: -2},
    },
    vertical: {cursor: 'col-resize'},
    horizontal: {cursor: 'row-resize'},
  }),
)
