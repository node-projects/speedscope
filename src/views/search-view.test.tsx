import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {SearchView} from './search-view'
import {searchIsActiveAtom, searchQueryAtom} from '../app-state'

test('explicit match zoom is available only with a selected result and does not navigate matches', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  searchIsActiveAtom.set(true)
  const zoom = jest.fn(),
    next = jest.fn(),
    prev = jest.fn()
  const view = (resultIndex: number | null, optional = true) => (
    <SearchView
      resultIndex={resultIndex}
      numResults={10_000}
      resultsLimited={true}
      selectNext={next}
      selectPrev={prev}
      zoomToMatch={optional ? zoom : undefined}
    />
  )
  try {
    act(() => render(view(null), host))
    let button = Array.from(host.querySelectorAll('button')).find(
      b => b.textContent === 'Zoom to match',
    )!
    expect(button.disabled).toBe(true)
    act(() => render(view(9_999), host))
    button = Array.from(host.querySelectorAll('button')).find(
      b => b.textContent === 'Zoom to match',
    )!
    expect(button.disabled).toBe(false)
    expect(button.title).toContain('Measured frame widths stay unchanged')
    act(() => button.click())
    expect(zoom).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
    expect(prev).not.toHaveBeenCalled()
    expect(host.textContent).toContain('10000/10000+')
    act(() => render(view(0, false), host))
    expect(host.textContent).not.toContain('Zoom to match')
  } finally {
    act(() => render(null, host))
    host.remove()
    searchIsActiveAtom.set(false)
  }
})

test('bounded navigation reports a lower bound, explains the limit and keeps controls usable', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  searchIsActiveAtom.set(true)
  const next = jest.fn(),
    prev = jest.fn()
  try {
    act(() =>
      render(
        <SearchView
          resultIndex={0}
          numResults={10000}
          resultsLimited={true}
          selectNext={next}
          selectPrev={prev}
        />,
        host,
      ),
    )
    expect(host.textContent).toContain('1/10000+')
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Refine your search')
    expect(host.querySelector('input')!.maxLength).toBe(4096)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!.click())
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')!.click())
    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)
    act(() =>
      render(
        <SearchView resultIndex={0} numResults={1} selectNext={next} selectPrev={prev} />,
        host,
      ),
    )
    expect(host.textContent).toContain('1/1')
    expect(host.querySelector('[role="status"]')).toBe(null)
  } finally {
    act(() => render(null, host))
    host.remove()
    searchIsActiveAtom.set(false)
    searchQueryAtom.set('')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
})
