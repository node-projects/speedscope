import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {FlamechartMinimapView} from './flamechart-minimap-view'
import {Flamechart} from '../lib/flamechart'
import {Rect, Vec2, clamp} from '../lib/math'
import {CanvasContext} from '../gl/canvas-context'
import {FlamechartRenderer} from '../gl/flamechart-renderer'
import {lightTheme} from './themes/light-theme'
import {minimapMousePositionAtom} from '../app-state'

let host: HTMLDivElement, previousCursor: string
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  previousCursor = document.body.style.cursor
  document.body.style.cursor = 'help'
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(async () => {
  act(() => render(null, host))
  host.remove()
  document.body.style.cursor = previousCursor
  jest.restoreAllMocks()
  await new Promise(resolve => setTimeout(resolve, 0))
})
function setup() {
  const context = {
    requestFrame: jest.fn(),
    addBeforeFrameHandler: jest.fn(),
    removeBeforeFrameHandler: jest.fn(),
  }
  const chart = {
    getTotalWeight: () => 100,
    getLayers: () => Array.from({length: 10}, () => []),
    getClampedViewportWidth: (v: number) => clamp(v, 1, 100),
    formatValue: String,
  } as unknown as Flamechart
  const set = jest.fn()
  const props = {
    theme: lightTheme,
    flamechart: chart,
    configSpaceViewportRect: new Rect(new Vec2(20, 0), new Vec2(20, 5)),
    canvasContext: context as unknown as CanvasContext,
    flamechartRenderer: {} as FlamechartRenderer,
    transformViewport: jest.fn(),
    setConfigSpaceViewportRect: set,
  }
  const draw = (next = props) => act(() => render(<FlamechartMinimapView {...next} />, host))
  draw()
  const overview = host.querySelector<HTMLDivElement>('[aria-label="Profile overview"]')!
  overview.getBoundingClientRect = () =>
    ({left: 0, top: 0, right: 640, bottom: 100, width: 640, height: 100}) as DOMRect
  const canvas = host.querySelector('canvas')!
  canvas.width = 640
  canvas.height = 100
  const mouse = (type: string, x = 200, button = 0) =>
    act(() => {
      overview.dispatchEvent(
        new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: 50, button}),
      )
    })
  return {context, chart, set, props, draw, overview, mouse}
}
test('hover cursors stay local and blur ends a drag without later viewport updates', () => {
  const {overview, mouse, set} = setup()
  mouse('mousemove')
  expect(overview.style.cursor).toBe('grab')
  expect(document.body.style.cursor).toBe('help')
  mouse('mousemove', 500)
  expect(overview.style.cursor).toBe('crosshair')
  mouse('mousedown')
  expect(document.activeElement).toBe(overview)
  expect(document.body.style.cursor).toBe('grabbing')
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 240, clientY: 50})))
  expect(set).toHaveBeenCalledTimes(1)
  act(() => void window.dispatchEvent(new Event('blur')))
  expect(document.body.style.cursor).toBe('help')
  expect(minimapMousePositionAtom.get()).toBe(null)
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 260, clientY: 50})))
  expect(set).toHaveBeenCalledTimes(1)
})
test('unmount during dragging removes global handlers and restores the prior cursor', () => {
  const {mouse, set, context} = setup()
  mouse('mousedown')
  act(() => render(null, host))
  expect(document.body.style.cursor).toBe('help')
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 250, clientY: 50})))
  expect(set).not.toHaveBeenCalled()
  expect(context.removeBeforeFrameHandler).toHaveBeenCalledTimes(1)
})
test('graph/context replacement cleans up both gestures and frame callbacks', () => {
  const {mouse, draw, props, set, context} = setup()
  mouse('mousedown')
  context.requestFrame.mockClear()
  const nextContext = {...context, addBeforeFrameHandler: jest.fn(), requestFrame: jest.fn()}
  draw({
    ...props,
    flamechart: {...props.flamechart} as Flamechart,
    canvasContext: nextContext as unknown as CanvasContext,
  })
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 250, clientY: 50})))
  expect(set).not.toHaveBeenCalled()
  expect(document.body.style.cursor).toBe('help')
  expect(context.removeBeforeFrameHandler).toHaveBeenCalledTimes(1)
  expect(nextContext.addBeforeFrameHandler).toHaveBeenCalledTimes(1)
  expect(context.requestFrame).not.toHaveBeenCalled()
  expect(nextContext.requestFrame).toHaveBeenCalledTimes(1)
})
test('keyboard navigation is focusable and leaves modified browser shortcuts alone', () => {
  const {overview, set} = setup()
  const globalKey = jest.fn()
  window.addEventListener('keydown', globalKey)
  try {
    expect(overview.tabIndex).toBe(0)
    const key = new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true})
    act(() => {
      overview.dispatchEvent(key)
    })
    expect(key.defaultPrevented).toBe(true)
    expect(globalKey).not.toHaveBeenCalled()
    expect(set.mock.calls[0][0].origin.x).toBe(22)
    act(() => {
      overview.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', ctrlKey: true, bubbles: true}))
    })
    expect(globalKey).toHaveBeenCalledTimes(1)
    expect(
      host.querySelector(`#${overview.getAttribute('aria-describedby')}`)!.textContent,
    ).toContain('Visible range: 20 to 40')
  } finally {
    window.removeEventListener('keydown', globalKey)
  }
})
test('non-primary buttons do not start dragging and cleanup preserves another owner cursor', () => {
  const {mouse, set} = setup()
  mouse('mousedown', 200, 2)
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 250, clientY: 50})))
  expect(set).not.toHaveBeenCalled()
  expect(document.body.style.cursor).toBe('help')
  mouse('mousedown')
  document.body.style.cursor = 'wait'
  act(() => void window.dispatchEvent(new Event('blur')))
  expect(document.body.style.cursor).toBe('wait')
})

test('release outside and Escape end gestures without leaking handlers or cursors', () => {
  const {mouse, overview, set} = setup()
  mouse('mousedown', 500)
  expect(document.body.style.cursor).toBe('crosshair')
  act(() => void window.dispatchEvent(new MouseEvent('mouseup', {clientX: 900, clientY: 500})))
  expect(document.body.style.cursor).toBe('help')
  expect(overview.style.cursor).toBe('')
  mouse('mousedown')
  act(() => {
    overview.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}),
    )
  })
  expect(document.body.style.cursor).toBe('help')
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', {clientX: 250, clientY: 50})))
  expect(set).not.toHaveBeenCalled()
})
