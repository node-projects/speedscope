import {h} from 'preact'
import {useMemo, useState, useEffect} from 'preact/hooks'
import {CallTreeNode, Profile} from '../lib/profile'
import {useTheme} from './themes/theme'

// Bound DOM size independently of total trace size. Expansion is explicit and
// traversal uses O(depth) storage, including for very deep recursive profiles.
export function getVisibleCallTreeRows(
  profile: Profile,
  expanded: Set<CallTreeNode>,
  limit: number,
) {
  const rows: {node: CallTreeNode; depth: number}[] = []
  const stack = [{nodes: profile.getGroupedCalltreeRoot().children, index: 0, depth: 0}]
  while (stack.length && rows.length <= limit) {
    const current = stack[stack.length - 1]
    if (current.index === current.nodes.length) {
      stack.pop()
      continue
    }
    const node = current.nodes[current.index++]
    rows.push({node, depth: current.depth})
    if (expanded.has(node) && node.children.length)
      stack.push({nodes: node.children, index: 0, depth: current.depth + 1})
  }
  return rows
}

export function CallTreeView({profile}: {profile: Profile}) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(new Set<CallTreeNode>())
  const [limit, setLimit] = useState(200)
  useEffect(() => {
    setExpanded(new Set())
    setLimit(200)
  }, [profile])
  const rows = useMemo(
    () => getVisibleCallTreeRows(profile, expanded, limit),
    [profile, expanded, limit],
  )
  function toggle(node: CallTreeNode) {
    const next = new Set(expanded)
    if (next.has(node)) next.delete(node)
    else next.add(node)
    setExpanded(next)
  }
  return (
    <section
      aria-label="Call tree"
      style={{
        overflow: 'auto',
        height: '100%',
        padding: 12,
        boxSizing: 'border-box',
        color: theme.fgPrimaryColor,
        background: theme.bgPrimaryColor,
      }}
    >
      <p>Expand functions to inspect their callees. Total includes callees; self excludes them.</p>
      <table style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
        <caption>
          {profile.getName()} — {profile.formatValue(profile.getTotalWeight())} total
        </caption>
        <thead>
          <tr>
            <th scope="col">Function</th>
            <th scope="col">Total</th>
            <th scope="col">Self</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map(({node, depth}, index) => (
            <tr key={index}>
              <td style={{paddingLeft: Math.min(depth, 32) * 16}}>
                {node.children.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={expanded.has(node)}
                    aria-label={`${expanded.has(node) ? 'Collapse' : 'Expand'} ${node.frame.name}`}
                    onClick={() => toggle(node)}
                  >
                    {expanded.has(node) ? '−' : '+'}
                  </button>
                )}{' '}
                {node.frame.name}
              </td>
              <td>{profile.formatValue(node.getTotalWeight())}</td>
              <td>{profile.formatValue(node.getSelfWeight())}</td>
              <td>
                {node.frame.file}
                {node.frame.line != null ? `:${node.frame.line}` : ''}
                {node.frame.col != null ? `:${node.frame.col}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 200)}>
          Show 200 more rows
        </button>
      )}
    </section>
  )
}
