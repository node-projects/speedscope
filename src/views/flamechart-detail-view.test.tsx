import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {CallTreeNode, Frame} from '../lib/profile'
import {StackTraceView} from './flamechart-detail-view'

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(async () => {
  act(() => render(null, host))
  host.remove()
  await new Promise(resolve => setTimeout(resolve, 0))
})
function chain(depth: number) {
  let node = new CallTreeNode(Frame.root, null)
  for (let i = 0; i < depth; i++)
    node = new CallTreeNode({name: `scope-${i}`, file: `src/scope-${i}.ts`} as Frame, node)
  return node
}

test('deep stack details page at 100 rows and select exact ancestor instances', () => {
  const node = chain(205)
  const onSelect = jest.fn()
  const draw = (selected: CallTreeNode) =>
    act(() =>
      render(
        <StackTraceView node={selected} getFrameColor={() => 'red'} onSelect={onSelect} />,
        host,
      ),
    )
  draw(node)
  expect(host.querySelectorAll('button[aria-label^="Select scope"]')).toHaveLength(100)
  expect(host.textContent).toContain('scope-204')
  act(() =>
    Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent === 'Show older ancestors')!
      .click(),
  )
  expect(host.querySelectorAll('button[aria-label^="Select scope"]')).toHaveLength(100)
  expect(host.textContent).toContain('scope-104')
  expect(host.textContent).not.toContain('scope-204')
  act(() =>
    Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent === 'Back to selected frame')!
      .click(),
  )
  expect(host.textContent).toContain('scope-204')
  const button = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Select scope"]')[1]
  button.focus()
  act(() => button.click())
  expect(onSelect).toHaveBeenCalledWith(node.parent)
  draw(node.parent!)
  expect(host.querySelector('[aria-current="true"]')!.textContent).toBe('scope-203')
  expect(document.activeElement).toBe(host.querySelector('[aria-current="true"]'))
  draw(chain(2))
  expect(host.querySelectorAll('button[aria-label^="Select scope"]')).toHaveLength(2)
  expect(host.textContent).not.toContain('Show older ancestors')
  act(() =>
    render(
      <StackTraceView node={node.parent!} getFrameColor={() => 'red'} onSelect={() => {}} />,
      host,
    ),
  )
  expect(host.querySelectorAll('button[aria-label^="Select scope"]')).toHaveLength(100)
  expect(host.querySelector('[aria-current="true"]')!.textContent).toBe('scope-203')
})

test('older pages remain reachable to the root and reset for a new selection', () => {
  const node = chain(205)
  act(() =>
    render(<StackTraceView node={node} getFrameColor={() => 'red'} onSelect={() => {}} />, host),
  )
  for (let i = 0; i < 2; i++)
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find(b => b.textContent === 'Show older ancestors')!
        .click(),
    )
  expect(host.querySelectorAll('button[aria-label^="Select scope"]')).toHaveLength(5)
  expect(host.textContent).toContain('scope-0')
  expect(host.textContent).not.toContain('Show older ancestors')
})
