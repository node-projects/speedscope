import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {SourceLinksDialog} from './source-links-dialog'
import {SourceLocation} from './source-location'
import {sourceLinkConfigAtom} from '../app-state/display-preferences'
import {defaultSourceLinkConfig} from '../lib/source-links'

let host: HTMLDivElement
beforeEach(() => {
  sourceLinkConfigAtom.set(null)
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(async () => {
  act(() => render(null, host))
  host.remove()
  sourceLinkConfigAtom.set(null)
  await new Promise(resolve => setTimeout(resolve, 0))
})

test('settings preview mapping, save and disable links without navigating', () => {
  const onClose = jest.fn()
  const sample = {key: 1, name: 'main', file: '/build/app/main.ts', line: 9, col: 2}
  act(() => render(<SourceLinksDialog sample={sample} onClose={onClose} />, host))
  expect(host.querySelector('[role="status"]')!.textContent).toContain(
    'vscode://file/build/app/main.ts:9:2',
  )
  const inputs = host.querySelectorAll('input')
  act(() => {
    inputs[0].value = '/build/app'
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}))
  })
  act(() => {
    inputs[1].value = 'C:/work/app'
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}))
  })
  expect(host.querySelector('[role="status"]')!.textContent).toContain(
    'vscode://file/C:/work/app/main.ts:9:2',
  )
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  expect(sourceLinkConfigAtom.get()!.toPrefix).toBe('C:/work/app')
  expect(onClose).toHaveBeenCalledTimes(1)
  act(() =>
    Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent === 'Disable links')!
      .click(),
  )
  expect(sourceLinkConfigAtom.get()).toBe(null)
})

test('invalid web templates show an error and do not save', () => {
  const onClose = jest.fn()
  act(() => render(<SourceLinksDialog sample={null} onClose={onClose} />, host))
  act(() => {
    const select = host.querySelector('select')!
    select.value = 'web'
    select.dispatchEvent(new Event('change', {bubbles: true}))
  })
  act(() => {
    const template = host.querySelector('input')!
    template.value = 'javascript:{file}'
    template.dispatchEvent(new Event('input', {bubbles: true}))
  })
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('HTTP')
  expect(sourceLinkConfigAtom.get()).toBe(null)
  expect(onClose).not.toHaveBeenCalled()
})

test('source locations react to configuration and preserve row selection on link clicks', () => {
  const rowClick = jest.fn()
  const frame = {file: '/src/main.ts', line: 7, col: 3}
  act(() =>
    render(
      <div onClick={rowClick}>
        <SourceLocation frame={frame} />
      </div>,
      host,
    ),
  )
  expect(host.querySelector('a')).toBe(null)
  act(() => sourceLinkConfigAtom.set(defaultSourceLinkConfig))
  const link = host.querySelector('a')!
  expect(link.getAttribute('href')).toBe('vscode://file/src/main.ts:7:3')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  link.addEventListener('click', event => event.preventDefault())
  act(() => link.click())
  expect(rowClick).not.toHaveBeenCalled()
  act(() => sourceLinkConfigAtom.set(null))
  expect(host.querySelector('a')).toBe(null)
  expect(host.textContent).toBe('/src/main.ts:7:3')
  act(() => render(<SourceLocation frame={{}} />, host))
  expect(host.textContent).toBe('')
})
