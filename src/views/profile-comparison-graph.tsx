import {h} from 'preact'
import {useEffect, useMemo, useRef, useState} from 'preact/hooks'
import {css, StyleSheet} from 'aphrodite'
import {ComparisonModel, ComparisonNode} from '../lib/profile-comparison'
import {layoutComparisonGraph, visibleComparisonTiles} from '../lib/profile-comparison-layout'
import {
  ByteFormatter,
  RawValueFormatter,
  TimeFormatter,
  ValueFormatter,
} from '../lib/value-formatters'
import {useTheme, withTheme} from './themes/theme'

const ROW_HEIGHT = 26
const VIEWPORT_HEIGHT = 312
const short = (value: string) => (value.length > 512 ? value.slice(0, 511) + '…' : value)

export interface ProfileComparisonGraphProps {
  model: ComparisonModel
  focusNode?: ComparisonNode | null
  selectedNode?: ComparisonNode | null
  onSelect(node: ComparisonNode): void
  onDrill(node: ComparisonNode): void
}

function formatter(model: ComparisonModel): ValueFormatter {
  return model.unit === 'bytes'
    ? new ByteFormatter()
    : model.unit === 'none'
      ? new RawValueFormatter()
      : new TimeFormatter(model.unit)
}

export function comparisonNodeDescription(model: ComparisonModel, node: ComparisonNode): string {
  const format = formatter(model)
  const unsigned = (value: number) =>
    model.mode === 'normalized' ? `${(value * 100).toFixed(2)}%` : format.format(value)
  const delta = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${
      model.mode === 'normalized'
        ? `${(Math.abs(value) * 100).toFixed(2)} percentage points`
        : format.format(Math.abs(value))
    }`
  const frame = node.frame
  const source = frame?.file
    ? `${short(frame.file)}${frame.line ? ':' + frame.line : ''}${frame.col ? ':' + frame.col : ''}`
    : 'Source not provided'
  return [
    frame ? short(frame.name) : 'All stacks',
    source,
    `Baseline total: ${unsigned(node.baselineTotal)}; self: ${unsigned(node.baselineSelf)}`,
    `Candidate total: ${unsigned(node.candidateTotal)}; self: ${unsigned(node.candidateSelf)}`,
    `Delta total: ${delta(node.totalDelta)}; self: ${delta(node.selfDelta)}`,
  ].join('\n')
}

export function ProfileComparisonGraph(props: ProfileComparisonGraphProps) {
  const {model} = props
  const focus = props.focusNode || model.root
  const theme = useTheme(),
    style = getStyle(theme)
  const viewport = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(VIEWPORT_HEIGHT)
  const [scrollTop, setScrollTop] = useState(0)
  const layout = useMemo(() => layoutComparisonGraph(focus, width), [focus, width])
  // Lazily cache only labels for bounded layout tiles, not the full union model.
  const descriptionCache = useMemo(
    () => ({layout, model, values: new Map<number, string>()}),
    [layout, model],
  )
  const descriptions = descriptionCache.values
  const visible = useMemo(
    () => visibleComparisonTiles(layout.tiles, scrollTop, height, ROW_HEIGHT),
    [layout, scrollTop, height],
  )

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width > 0) setWidth(bounds.width)
      if (bounds.height > 0) setHeight(bounds.height)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [focus])
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0
    setScrollTop(0)
  }, [focus])

  return (
    <section aria-label="Comparison flamegraph" className={css(style.section)}>
      <p className={css(style.description)}>
        Width is a comparison layout weight: the union of both call trees, not elapsed time. Click
        to select; double-click to focus a call path.
      </p>
      <div className={css(style.legend)} aria-label="Candidate minus baseline color legend">
        <span>
          <span aria-hidden="true" className={css(style.swatch, style.increase)} />
          Increase
        </span>
        <span>
          <span aria-hidden="true" className={css(style.swatch, style.decrease)} />
          Decrease
        </span>
        <span>
          <span aria-hidden="true" className={css(style.swatch, style.unchanged)} />
          Unchanged
        </span>
      </div>
      {layout.tiles.length ? (
        <div
          ref={viewport}
          className={css(style.viewport)}
          style={{height: Math.min(VIEWPORT_HEIGHT, layout.rows * ROW_HEIGHT)}}
          tabIndex={0}
          aria-label="Scrollable comparison flamegraph"
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className={css(style.canvas)} style={{height: layout.rows * ROW_HEIGHT}}>
            {visible.map(tile => {
              const node = tile.node
              let description = descriptions.get(node.id)
              if (description === undefined) {
                description = comparisonNodeDescription(model, node)
                descriptions.set(node.id, description)
              }
              const change =
                node.totalDelta > 0 ? 'increase' : node.totalDelta < 0 ? 'decrease' : 'unchanged'
              const strength =
                model.maxAbsDelta > 0
                  ? Math.min(1, Math.abs(node.totalDelta) / model.maxAbsDelta)
                  : 0
              const opacity = 0.18 + 0.42 * strength
              const background =
                change === 'increase'
                  ? `rgba(215, 70, 63, ${opacity})`
                  : change === 'decrease'
                    ? `rgba(58, 118, 203, ${opacity})`
                    : theme.bgSecondaryColor
              return (
                <button
                  key={node.id}
                  type="button"
                  className={css(style.tile, props.selectedNode === node && style.selected)}
                  data-comparison-node={node.id}
                  data-depth={tile.depth}
                  data-change={change}
                  aria-label={description}
                  aria-pressed={props.selectedNode === node}
                  title={description}
                  style={{
                    left: `${tile.left * 100}%`,
                    width: `${tile.width * 100}%`,
                    top: tile.depth * ROW_HEIGHT,
                    background,
                  }}
                  onClick={() => props.onSelect(node)}
                  onFocus={() => props.onSelect(node)}
                  onDblClick={() => props.onDrill(node)}
                >
                  {tile.width * width >= 24 ? (
                    <span className={css(style.tileLabel)}>
                      {node.frame ? short(node.frame.name) : 'All stacks'}
                    </span>
                  ) : (
                    ''
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p role="status">No comparison weight in this call path.</p>
      )}
      {(layout.budgetLimited || layout.depthLimited || layout.hiddenSmall > 0) && (
        <p role="status" className={css(style.description)}>
          {layout.budgetLimited ? 'Graph detail limit reached. ' : ''}
          {layout.depthLimited ? 'Only the first 128 levels are shown. ' : ''}
          {layout.hiddenSmall > 0 ? 'Subpixel call paths are hidden. ' : ''}
          Select a call path in the table and zoom to it to explore further.
        </p>
      )}
    </section>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    section: {display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0},
    description: {margin: 0, fontSize: 12, lineHeight: 1.5, color: theme.fgSecondaryColor},
    legend: {display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12},
    swatch: {
      display: 'inline-block',
      width: 12,
      height: 12,
      verticalAlign: 'middle',
      marginRight: 5,
      border: `1px solid ${theme.fgSecondaryColor}`,
      borderRadius: 2,
    },
    increase: {background: 'rgba(215, 70, 63, .6)'},
    decrease: {background: 'rgba(58, 118, 203, .6)'},
    unchanged: {background: theme.bgSecondaryColor},
    viewport: {
      overflow: 'auto',
      border: `1px solid ${theme.fgSecondaryColor}`,
      borderRadius: 6,
      background: theme.bgPrimaryColor,
      position: 'relative',
    },
    canvas: {position: 'relative', width: '100%'},
    tile: {
      position: 'absolute',
      height: ROW_HEIGHT - 1,
      boxSizing: 'border-box',
      border: 'none',
      boxShadow: `inset 0 0 0 1px ${theme.bgPrimaryColor}`,
      borderRadius: 2,
      minWidth: 0,
      padding: 0,
      margin: 0,
      color: theme.fgPrimaryColor,
      font: '12px/1.5 system-ui, sans-serif',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      textAlign: 'left',
      cursor: 'pointer',
      ':focus': {outline: `2px solid ${theme.selectionPrimaryColor}`, outlineOffset: -2},
    },
    tileLabel: {
      display: 'block',
      width: '100%',
      boxSizing: 'border-box',
      padding: '2px 5px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    selected: {boxShadow: `inset 0 0 0 2px ${theme.selectionPrimaryColor}`},
  }),
)
