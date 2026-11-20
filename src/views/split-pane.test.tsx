import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {SplitPane, clampSplitFraction, readSplitFraction} from './split-pane'
import {StyleSheetTestUtils} from 'aphrodite'

const pointerProperties: string[] = []
beforeAll(() => {
  StyleSheetTestUtils.suppressStyleInjection()
  // JSDOM lacks pointer-handler properties used by Preact's event-name detection.
  for (const name of ['onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel']) {
    if (!(name in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        value: null,
        writable: true,
      })
      pointerProperties.push(name)
    }
  }
})
afterAll(() => {
  StyleSheetTestUtils.clearBufferAndResumeStyleInjection()
  for (const name of pointerProperties) delete (HTMLElement.prototype as any)[name]
})

test('split fractions enforce minimum sizes and recover from corrupt saved values', () => {
  expect(clampSplitFraction(0.01, 800, 160)).toBe(0.2)
  expect(clampSplitFraction(1, 800, 160)).toBe(0.8)
  expect(clampSplitFraction(0.1, 100, 160)).toBe(0.5)
  expect(clampSplitFraction(NaN)).toBe(0.5)
  localStorage.setItem('test-split', 'not a number')
  expect(readSplitFraction('test-split')).toBe(0.5)
  localStorage.removeItem('test-split')
})
test('split handles support keyboard resizing, persistence, orientation and reset', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const props = {
    direction: 'row' as const,
    storageKey: 'test-split',
    label: 'Resize table',
    minimumSize: 160,
    first: <div>Table</div>,
    second: <div>Graph</div>,
  }
  act(() => render(<SplitPane {...props} />, host))
  const handle = host.querySelector('[role="separator"]')!
  expect(handle.getAttribute('aria-orientation')).toBe('vertical')
  act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}))
  })
  expect(handle.getAttribute('aria-valuenow')).toBe('52')
  expect(Number(localStorage.getItem('test-split'))).toBe(0.52)
  act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}))
  })
  expect(handle.getAttribute('aria-valuenow')).toBe('85')
  act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
  })
  expect(handle.getAttribute('aria-valuenow')).toBe('50')
  act(() => render(null, host))
  host.remove()
  localStorage.removeItem('test-split')
})

test('pointer drags use the pane bounds and persist the completed resize', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <SplitPane
        direction="row"
        storageKey="test-pointer-split"
        label="Resize"
        minimumSize={160}
        first={<div>First</div>}
        second={<div>Second</div>}
      />,
      host,
    ),
  )
  const root = host.firstElementChild as HTMLDivElement
  jest
    .spyOn(root, 'getBoundingClientRect')
    .mockReturnValue({width: 1000, height: 600, left: 10, top: 20} as DOMRect)
  const handle = host.querySelector('[role="separator"]')!
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, {bubbles: true, button: 0, clientX})
    Object.defineProperty(event, 'pointerId', {value: 1})
    act(() => {
      handle.dispatchEvent(event)
    })
  }
  pointer('pointerdown', 510)
  pointer('pointermove', 810)
  pointer('pointerup', 810)
  expect(Number(handle.getAttribute('aria-valuenow'))).toBe(80)
  expect(Number(localStorage.getItem('test-pointer-split'))).toBeCloseTo((810 - 10 - 3) / 994)
  act(() => render(null, host))
  host.remove()
  localStorage.removeItem('test-pointer-split')
})
