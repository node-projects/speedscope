import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {StyleSheetTestUtils} from 'aphrodite'
import {InstantEventsDialog} from './instant-events-dialog'
import {InstantTimelineRow} from '../lib/instant-track-layout'

let host: HTMLDivElement
beforeEach(() => {
  StyleSheetTestUtils.suppressStyleInjection()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
  StyleSheetTestUtils.clearBufferAndResumeStyleInjection()
})
function row(count: number): InstantTimelineRow {
  return {
    kind: 'instant',
    instantIndex: 0,
    offset: 0,
    instant: {
      id: 'lane',
      name: 'Lane',
      scope: 'global',
      clock: 'wall',
      start: 100,
      timeUnit: 'microseconds',
      times: Float64Array.from(Array(count).fill(0)),
      events: Array.from({length: count}, (_, i) => ({
        name: `event ${i}`,
        category: 'category',
        details: `details ${i}`,
      })),
    },
  }
}
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(value => value.textContent === text)!

test('all coincident events are paged in source order, details stay plain text and only one expands', () => {
  const original = row(201)
  const event = {
    name: '<script>alert(1)</script>',
    category: '<b>category</b>',
    details: '<img src=x onerror=alert(1)> unresolved sf=42',
  }
  const input = {
    ...original,
    instant: {...original.instant, events: [event, ...original.instant.events.slice(1)]},
  }
  act(() =>
    render(
      <InstantEventsDialog row={input} viewport={{left: 0, width: 1}} onClose={() => {}} />,
      host,
    ),
  )
  expect(host.querySelectorAll('[data-instant-event-index]')).toHaveLength(100)
  expect(host.textContent).toContain('Events 1–100 of 201')
  expect(host.querySelector('script')).toBeNull()
  act(() => button('Show details').click())
  expect(host.querySelectorAll('pre')).toHaveLength(1)
  expect(host.querySelector('pre')!.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(host.querySelector('img')).toBeNull()
  act(() => button('Next page').click())
  expect(host.textContent).toContain('Events 101–200 of 201')
  expect(host.querySelector('pre')).toBeNull()
  act(() => button('Next page').click())
  expect(host.querySelectorAll('[data-instant-event-index]')).toHaveLength(1)
  expect(host.textContent).toContain('event 200')
  const page = host.querySelector<HTMLInputElement>('input')!
  act(() => {
    page.value = '1'
    page.dispatchEvent(new Event('input', {bubbles: true}))
  })
  expect(host.textContent).toContain('Events 1–100 of 201')
})

test('stored origin and offset remain exact when a computed absolute timestamp rounds or overflows', () => {
  for (const [origin, offset] of [
    [1e20, 0.1],
    [1e308, 1e308],
  ]) {
    const input = row(1)
    const value = {...input.instant, start: origin, times: Float64Array.from([offset])}
    act(() =>
      render(
        <InstantEventsDialog
          row={{...input, instant: value}}
          viewport={{left: 0, width: Math.max(1, offset)}}
          onClose={() => {}}
        />,
        host,
      ),
    )
    expect(host.textContent).toContain(
      `Stored source origin: ${origin} microseconds; local offset: ${offset} microseconds`,
    )
    expect(host.textContent).not.toContain('Infinity microseconds')
    if (Number.isFinite(origin + offset))
      expect(host.textContent).toContain('Computed source timestamp (may round)')
  }
})

test('native Escape cancellation isolates keyboard shortcuts and restores the opener on disposal', () => {
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const close = jest.fn(),
    globalKey = jest.fn()
  window.addEventListener('keydown', globalKey)
  act(() =>
    render(
      <InstantEventsDialog row={row(1)} viewport={{left: 0, width: 1}} onClose={close} />,
      host,
    ),
  )
  const dialog = host.querySelector('dialog')!
  expect(document.activeElement?.textContent).toBe('Close')
  act(() => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Escape'}))
    dialog.dispatchEvent(new Event('cancel', {cancelable: true}))
  })
  expect(close).toHaveBeenCalledTimes(1)
  expect(globalKey).not.toHaveBeenCalled()
  act(() => render(null, host))
  expect(document.activeElement).toBe(opener)
  window.removeEventListener('keydown', globalKey)
  opener.remove()
})
