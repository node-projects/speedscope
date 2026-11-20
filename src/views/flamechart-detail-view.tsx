import {StyleDeclarationValue, css} from 'aphrodite'
import {h, JSX} from 'preact'
import {useLayoutEffect, useRef, useState} from 'preact/hooks'
import {getFlamechartStyle} from './flamechart-style'
import {formatPercent} from '../lib/utils'
import {Frame, CallTreeNode} from '../lib/profile'
import {ColorChit} from './color-chit'
import {Flamechart} from '../lib/flamechart'
import {useTheme} from './themes/theme'
import {SourceLocation} from './source-location'
import {stackPage} from '../lib/stack-page'
import {weightPercentage} from '../lib/profile-context'

interface StatisticsTableProps {
  title: string
  description: string
  grandTotal: number
  selectedTotal: number
  selectedSelf: number
  cellStyle: StyleDeclarationValue
  formatter: (v: number) => string
}

function StatisticsTable(props: StatisticsTableProps) {
  const style = getFlamechartStyle(useTheme())

  const total = props.formatter(props.selectedTotal)
  const self = props.formatter(props.selectedSelf)
  const totalPerc = weightPercentage(props.selectedTotal, props.grandTotal)
  const selfPerc = weightPercentage(props.selectedSelf, props.grandTotal)

  return (
    <div
      role="group"
      aria-label={`${props.title}: ${props.description}`}
      className={css(style.statsTable)}
    >
      <div
        title={props.description}
        className={css(props.cellStyle, style.statsTableCell, style.statsTableHeader)}
      >
        {props.title}
      </div>

      <div
        title="Total includes work in callees."
        className={css(props.cellStyle, style.statsTableCell)}
      >
        Total
      </div>
      <div
        title="Self excludes work in callees."
        className={css(props.cellStyle, style.statsTableCell)}
      >
        Self
      </div>

      <div className={css(props.cellStyle, style.statsTableCell)}>{total}</div>
      <div className={css(props.cellStyle, style.statsTableCell)}>{self}</div>

      <div className={css(props.cellStyle, style.statsTableCell)}>
        {formatPercent(totalPerc)}
        <div
          className={css(style.barDisplay)}
          style={{height: `${Math.min(100, Math.max(0, totalPerc))}%`}}
        />
      </div>
      <div className={css(props.cellStyle, style.statsTableCell)}>
        {formatPercent(selfPerc)}
        <div
          className={css(style.barDisplay)}
          style={{height: `${Math.min(100, Math.max(0, selfPerc))}%`}}
        />
      </div>
    </div>
  )
}

interface StackTraceViewProps {
  getFrameColor: (frame: Frame) => string
  node: CallTreeNode
  onSelect: (node: CallTreeNode) => void
}
export function StackTraceView(props: StackTraceViewProps) {
  const style = getFlamechartStyle(useTheme())
  const [page, setPage] = useState({selected: props.node, start: props.node})
  if (page.selected !== props.node) {
    setPage({selected: props.node, start: props.node})
  }
  const start = page.selected === props.node ? page.start : props.node
  const {nodes, next} = stackPage(start)
  const container = useRef<HTMLDivElement>(null)
  const previousSelection = useRef(props.node)
  useLayoutEffect(() => {
    const element = container.current!
    element.scrollTop = 0
    if (previousSelection.current !== props.node && element.contains(document.activeElement)) {
      element.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
    }
    previousSelection.current = props.node
  }, [props.node, start])

  const rows: JSX.Element[] = []
  for (const node of nodes) {
    const row: (JSX.Element | string)[] = []
    const {frame} = node

    row.push(<ColorChit color={props.getFrameColor(frame)} />)

    if (rows.length) {
      row.push(<span className={css(style.stackFileLine)}>&gt; </span>)
    }
    row.push(
      <button
        className={css(style.stackSelect)}
        type="button"
        aria-label={`Select scope ${frame.name}`}
        aria-current={node === props.node ? 'true' : undefined}
        onClick={() => props.onSelect(node)}
      >
        {frame.name}
      </button>,
    )

    if (frame.file) {
      row.push(
        <span className={css(style.stackFileLine)}>
          {' '}
          (<SourceLocation frame={frame} />)
        </span>,
      )
    }
    rows.push(<div className={css(style.stackLine)}>{row}</div>)
  }
  return (
    <div ref={container} className={css(style.stackTraceView)}>
      <div className={css(style.stackTraceViewPadding)}>
        <details>
          <summary>About these statistics</summary>
          <p>
            This Instance measures the selected call-tree node. All Instances measures the selected
            function across this profile. Left Heavy groups calls with the same stack context, so
            one node can combine multiple calls.
          </p>
          <p>
            Total includes callees; Self excludes callees. Percentages use the entire current
            profile, including idle weight. Filtered profiles use their retained weight. A
            zero-weight profile shows 0%. Values use the profile's units, which may represent time,
            bytes or samples.
          </p>
        </details>
        <nav aria-label="Stack ancestors">
          {start !== props.node && (
            <button
              type="button"
              onClick={() => setPage({selected: props.node, start: props.node})}
            >
              Back to selected frame
            </button>
          )}
          {next && (
            <button type="button" onClick={() => setPage({selected: props.node, start: next})}>
              Show older ancestors
            </button>
          )}
          {(next || start !== props.node) && <span> Up to 100 scopes per page.</span>}
        </nav>
        {rows}
      </div>
    </div>
  )
}

interface FlamechartDetailViewProps {
  flamechart: Flamechart
  getCSSColorForFrame: (frame: Frame) => string
  selectedNode: CallTreeNode
  onSelect: (node: CallTreeNode) => void
}

export function FlamechartDetailView(props: FlamechartDetailViewProps) {
  const style = getFlamechartStyle(useTheme())

  const {flamechart, selectedNode} = props
  const {frame} = selectedNode

  return (
    <div className={css(style.detailView)}>
      <StatisticsTable
        title={'This Instance'}
        description="The selected call-tree node, including calls grouped in this stack context."
        cellStyle={style.thisInstanceCell}
        grandTotal={flamechart.getTotalWeight()}
        selectedTotal={selectedNode.getTotalWeight()}
        selectedSelf={selectedNode.getSelfWeight()}
        formatter={flamechart.formatValue.bind(flamechart)}
      />
      <StatisticsTable
        title={'All Instances'}
        description="The selected function across the current profile."
        cellStyle={style.allInstancesCell}
        grandTotal={flamechart.getTotalWeight()}
        selectedTotal={frame.getTotalWeight()}
        selectedSelf={frame.getSelfWeight()}
        formatter={flamechart.formatValue.bind(flamechart)}
      />
      <StackTraceView
        node={selectedNode}
        getFrameColor={props.getCSSColorForFrame}
        onSelect={props.onSelect}
      />
    </div>
  )
}
