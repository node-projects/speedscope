import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {ScrollableListView} from './scrollable-list-view'

test('fixed-row scrolling, selection offset, filtering and element resize render only visible rows', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  let height = 100
  const bounds = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  bounds.mockImplementation(
    () => ({width: 300, height, top: 0, left: 0, bottom: height, right: 300}) as DOMRect,
  )
  const previousObserver = (globalThis as any).ResizeObserver
  let resize = () => {}
  const disconnect = jest.fn()
  ;(globalThis as any).ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback
    }
    observe() {}
    disconnect = disconnect
  }
  const draw = (count: number, selected = 95) => (
    <ScrollableListView
      axis="y"
      itemCount={count}
      itemSize={20}
      initialIndexInView={selected}
      renderItems={(first, last) =>
        Array.from({length: Math.max(0, last - first + 1)}, (_, index) => (
          <div key={first + index} data-row={first + index}>
            {first + index}
          </div>
        ))
      }
    />
  )
  const indices = () =>
    Array.from(host.querySelectorAll('[data-row]'), row => Number(row.getAttribute('data-row')))
  try {
    act(() => render(draw(100), host))
    const viewport = host.firstElementChild as HTMLDivElement
    expect(viewport.scrollTop).toBe(1900)
    expect(indices()).toEqual([93, 94, 95, 96, 97, 98, 99])
    act(() => {
      viewport.scrollTop = 1000
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(indices()[0]).toBe(48)
    expect(indices().length).toBe(9)
    act(() => {
      height = 200
      resize()
    })
    expect(indices()[0]).toBe(47)
    expect(indices().length).toBe(16)
    act(() => render(draw(3), host))
    expect(viewport.scrollTop).toBe(0)
    expect(indices()).toEqual([0, 1, 2])
    act(() => render(draw(0), host))
    expect(indices()).toEqual([])
    act(() => render(null, host))
    expect(disconnect).toHaveBeenCalled()
  } finally {
    act(() => render(null, host))
    host.remove()
    bounds.mockRestore()
    ;(globalThis as any).ResizeObserver = previousObserver
  }
})
