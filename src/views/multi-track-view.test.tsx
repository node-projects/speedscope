import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {StyleSheetTestUtils} from 'aphrodite'
import {CallTreeProfileBuilder} from '../lib/profile'
import {TimeFormatter} from '../lib/value-formatters'
import {MultiTrackView} from './multi-track-view'

let host: HTMLDivElement
const context = {
  setTransform: jest.fn(),
  fillRect: jest.fn(),
  fillText: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
}
beforeEach(() => {
  StyleSheetTestUtils.suppressStyleInjection()
  host = document.createElement('div')
  document.body.appendChild(host)
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => context as unknown as CanvasRenderingContext2D)
  context.fillRect.mockClear()
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
  jest.restoreAllMocks()
  StyleSheetTestUtils.clearBufferAndResumeStyleInjection()
})
function profile(name: string, start?: number, clock = 'recording') {
  const builder = new CallTreeProfileBuilder(20)
  builder.setName(name)
  builder.enterFrame({key: name, name, color: '#8A2BE2'}, 0)
  builder.leaveFrame({key: name, name}, 10)
  const result = builder.build()
  result.setValueFormatter(new TimeFormatter('microseconds'))
  if (start !== undefined) result.setTimelineOrigin({clock, start})
  return result
}
async function mount(
  profiles: ReturnType<typeof profile>[],
  selectedProfileIndex = 0,
  onSelectProfile = jest.fn(),
) {
  await act(async () => {
    render(
      <MultiTrackView
        profiles={profiles}
        selectedProfileIndex={selectedProfileIndex}
        onSelectProfile={onSelectProfile}
      />,
      host,
    )
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
  return onSelectProfile
}
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(element => element.textContent === text)!

test('missing origins produce explicit exclusions and cannot align profiles at guessed zero', async () => {
  await mount([profile('unanchored')])
  expect(host.textContent).toContain('No aligned thread timelines')
  expect(host.textContent).toContain('No explicit shared-clock timeline origin')
  expect(host.querySelector('canvas')).toBeNull()
})

test('thread rows share an axis, retain offsets and open the correct original profile', async () => {
  const select = await mount([profile('first', 100), profile('later', 105), profile('unknown')])
  expect(host.textContent).toContain('2 aligned profiles')
  expect(host.textContent).toContain('1 unanchored/unsupported profiles excluded')
  expect(host.textContent).toContain('First 8 stack levels')
  // 25us extent: the second thread begins 5us later (160 of 800 pixels).
  expect(
    context.fillRect.mock.calls.some(call => call[0] === 160 && call[1] === 188 && call[2] === 319),
  ).toBe(true)
  act(() => button('Open profile: later').click())
  expect(select).toHaveBeenCalledWith(1)
})

test('crosshair hover reuses extraction and canvas geometry; keyboard pan/zoom/reset changes shared time', async () => {
  const input = profile('first', 100)
  const scan = jest.spyOn(input, 'getCallEvents')
  await mount([input])
  const scans = scan.mock.calls.length,
    paints = context.fillRect.mock.calls.length
  const canvas = host.querySelector('canvas')!
  act(() => {
    canvas.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 400, clientY: 35}))
  })
  expect(host.textContent).toContain('Shared time marker: 10.00µs')
  expect(scan.mock.calls.length).toBe(scans)
  expect(context.fillRect.mock.calls.length).toBe(paints)
  const viewport = host.querySelector<HTMLDivElement>('[aria-label^="Thread timelines;"]')!
  await act(async () => {
    viewport.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: '+'}))
    await Promise.resolve()
  })
  expect(scan.mock.calls.length).toBeGreaterThan(scans)
  await act(async () => {
    viewport.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'ArrowRight'}))
    await Promise.resolve()
  })
  await act(async () => {
    viewport.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Home'}))
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
  expect(host.textContent).toContain('Visible timelines ready')
})

test('large thread groups virtualize row controls and bound canvas dimensions', async () => {
  const profiles = Array.from({length: 200}, (_, index) => profile(`thread ${index}`, 100))
  await mount(profiles)
  const rows = () =>
    Array.from(host.querySelectorAll('button')).filter(
      element => element.textContent?.startsWith('Open profile:'),
    )
  expect(rows().length).toBeLessThanOrEqual(24)
  expect(host.textContent).not.toContain('Open profile: thread 199')
  const canvas = host.querySelector('canvas')!
  expect(canvas.width).toBeLessThanOrEqual(4096)
  expect(canvas.height).toBeLessThanOrEqual(2048)
  const viewport = host.querySelector<HTMLDivElement>('[aria-label^="Thread timelines;"]')!
  await act(async () => {
    viewport.scrollTop = 158 * 195
    viewport.dispatchEvent(new Event('scroll', {bubbles: true}))
    await Promise.resolve()
  })
  expect(host.textContent).toContain('Open profile: thread 195')
  expect(rows().length).toBeLessThanOrEqual(24)
  expect(host.textContent).not.toContain('Open profile: thread 0 (selected)')
})

test('shared marker readouts distinguish recorded functions, missing calls and recording extents', async () => {
  await mount([profile('first', 100), profile('later', 115)])
  const canvas = host.querySelector('canvas')!
  const point = (time: number) =>
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('mousemove', {bubbles: true, clientX: (time / 35) * 800, clientY: 35}),
      )
    })
  point(5)
  expect(host.textContent).toContain('At marker: first')
  expect(host.textContent).toContain('Outside recording')
  point(12)
  expect(host.textContent).toContain('No recorded call')
  point(22)
  expect(host.textContent).toContain('At marker: later')
  expect(host.textContent).toContain('Outside recording')
})

test('clock groups remain separate and selected profile chooses its compatible group', async () => {
  await mount([profile('one', 0, 'A'), profile('two', 0, 'A'), profile('three', 0, 'B')], 2)
  const select = host.querySelector<HTMLSelectElement>('select')!
  expect(select.selectedOptions[0].textContent).toContain('B')
  expect(host.textContent).toContain('1 aligned profiles')
  expect(host.textContent).toContain('2 profiles use other clocks or units')
  await act(async () => {
    select.value = select.options[0].value
    select.dispatchEvent(new Event('change', {bubbles: true}))
    await Promise.resolve()
  })
  expect(host.textContent).toContain('2 aligned profiles')
  expect(host.textContent).not.toContain('Open profile: three')
})

test('a replacement recording with the same clock resets marker, zoom and vertical scroll', async () => {
  await mount([profile('old', 100), profile('second', 100)])
  const canvas = host.querySelector('canvas')!
  act(() => {
    canvas.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 200, clientY: 35}))
    button('Zoom in').click()
  })
  const viewport = host.querySelector<HTMLDivElement>('[aria-label^="Thread timelines;"]')!
  act(() => {
    viewport.scrollTop = 158
    viewport.dispatchEvent(new Event('scroll', {bubbles: true}))
  })
  await mount([profile('replacement', 1000)])
  expect(host.textContent).toContain('reference 1000 microseconds')
  expect(host.textContent).toContain('Point at a time to align activity')
  expect(viewport.scrollTop).toBe(0)
  expect(host.textContent).not.toContain('Open profile: old')
  expect(host.textContent).toContain('18.00µs')
})

test('missing or failed canvas contexts report an error while individual profiles remain reachable', async () => {
  for (const throws of [false, true]) {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      if (throws) throw new Error('Canvas allocation failed')
      return null
    })
    const select = jest.fn()
    await mount([profile(`source-${throws}`, 100)], 0, select)
    expect(host.querySelector('[role="status"]')!.textContent).toContain(
      'timeline canvas is unavailable',
    )
    act(() => button(`Open profile: source-${throws} (selected)`).click())
    expect(select).toHaveBeenCalledWith(0)
  }
})
