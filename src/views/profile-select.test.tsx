import {h, render} from 'preact'
import {useState} from 'preact/hooks'
import {act} from 'preact/test-utils'
import {ProfileSelect, PROFILE_SELECT_PAGE_SIZE} from './profile-select'
import {Profile, CallTreeProfileBuilder} from '../lib/profile'
import {ProfileGroupAtom} from '../app-state/profile-group'
import {Toolbar} from './toolbar'
import {ViewMode} from '../lib/view-mode'

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
function profiles(count: number) {
  return Array.from(
    {length: count},
    (_, i) =>
      ({
        getName: () => `worker-${String(i).padStart(5, '0')}`,
        getTotalNonIdleWeight: () => i + 1,
        formatValue: (value: number) => `${value} ms`,
      }) as unknown as Profile,
  )
}
function mount(items: Profile[], index = 0) {
  const select = jest.fn(),
    close = jest.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Choose profile
        </button>
        <ProfileSelect
          profiles={items}
          indexToView={index}
          visible={open}
          setProfileIndexToView={select}
          closeProfileSelect={() => {
            close()
            setOpen(false)
          }}
        />
        <button type="button">After selector</button>
      </div>
    )
  }
  act(() => render(<Harness />, host))
  const trigger = host.querySelector('button')!
  act(() => {
    trigger.focus()
    trigger.click()
  })
  return {select, close, trigger, input: host.querySelector<HTMLInputElement>('[role="combobox"]')!}
}
function key(input: Element, keyValue: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: keyValue,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  act(() => {
    input.dispatchEvent(event)
  })
  return event
}
function active(input: HTMLInputElement) {
  return document.getElementById(input.getAttribute('aria-activedescendant') || '')
}
function filter(input: HTMLInputElement, query: string) {
  act(() => {
    input.value = query
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

test('opening focuses a named combobox and renders a bounded selected-profile page', () => {
  const {input} = mount(profiles(10000), 9876)
  expect(document.activeElement).toBe(input)
  expect(input.getAttribute('aria-label')).toBe('Filter profiles')
  expect(input.getAttribute('aria-controls')).toBe('profile-select-options')
  expect(input.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelectorAll('[role="option"]').length).toBe(PROFILE_SELECT_PAGE_SIZE)
  expect(active(input)!.textContent).toContain('worker-09876')
  expect(active(input)!.getAttribute('aria-selected')).toBe('true')
  expect(active(input)!.getAttribute('aria-posinset')).toBe('9877')
  expect(active(input)!.getAttribute('aria-setsize')).toBe('10000')
  expect(host.querySelector('[role="status"]')!.textContent).toBe('9801–9900 of 10000 profiles')
})

test('arrows, pages and endpoints keep the active descendant mounted and selection is explicit', () => {
  const {input, select, trigger} = mount(profiles(205), 99)
  expect(key(input, 'ArrowDown').defaultPrevented).toBe(true)
  expect(active(input)!.getAttribute('aria-posinset')).toBe('101')
  expect(host.querySelectorAll('[role="option"]').length).toBe(100)
  key(input, 'End')
  expect(active(input)!.getAttribute('aria-posinset')).toBe('205')
  expect(host.querySelectorAll('[role="option"]').length).toBe(5)
  key(input, 'PageUp')
  expect(active(input)!.getAttribute('aria-posinset')).toBe('105')
  key(input, 'Home')
  key(input, 'ArrowUp')
  expect(active(input)!.getAttribute('aria-posinset')).toBe('1')
  expect(select).not.toHaveBeenCalled()
  key(input, 'PageDown')
  key(input, 'Enter')
  expect(select).toHaveBeenCalledWith(100)
  expect(host.querySelector('[role="combobox"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('filtering resets active results and empty results never retain a stale selectable option', () => {
  const {input, select} = mount(profiles(205), 204)
  filter(input, 'worker-00012')
  expect(host.querySelectorAll('[role="option"]').length).toBe(1)
  expect(active(input)!.textContent).toContain('worker-00012')
  filter(input, 'no such profile')
  expect(host.querySelectorAll('[role="option"]').length).toBe(0)
  expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  key(input, 'Enter')
  expect(select).not.toHaveBeenCalled()
  expect(host.querySelector('[role="combobox"]')).toBe(input)
})

test('composition and editing shortcuts are preserved, while profile shortcuts do not leak globally', () => {
  const {input, select, close} = mount(profiles(3))
  const globalKey = jest.fn()
  window.addEventListener('keydown', globalKey)
  try {
    expect(key(input, 'Enter', {isComposing: true}).defaultPrevented).toBe(false)
    key(input, 'Escape', {isComposing: true})
    expect(key(input, 'a', {ctrlKey: true}).defaultPrevented).toBe(false)
    expect(select).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(globalKey).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', globalKey)
  }
})

test('native sorting and page buttons expose state without creating more option DOM', () => {
  const {input} = mount(profiles(205))
  const sort = host.querySelector<HTMLButtonElement>('[aria-label="Sort profiles by weight"]')!
  act(() => sort.click())
  expect(sort.getAttribute('aria-pressed')).toBe('true')
  expect(sort.getAttribute('aria-label')).toContain('descending')
  expect(active(input)!.textContent).toContain('worker-00000')
  // The currently selected profile stays active after sorting.
  expect(active(input)!.getAttribute('aria-posinset')).toBe('205')
  const previous = host.querySelector<HTMLButtonElement>(
    '[aria-label="Previous profile results page"]',
  )!
  act(() => previous.click())
  expect(active(input)!.getAttribute('aria-posinset')).toBe('101')
  expect(host.querySelectorAll('[role="option"]').length).toBe(100)
})

test('Escape restores trigger focus while leaving the popup preserves the next focused control', () => {
  const first = mount(profiles(3))
  key(first.input, 'Escape')
  expect(document.activeElement).toBe(first.trigger)
  act(() => first.trigger.click())
  const outside = Array.from(host.querySelectorAll('button')).find(
    b => b.textContent === 'After selector',
  )!
  act(() => outside.focus())
  expect(host.querySelector('[role="combobox"]')).toBeNull()
  expect(document.activeElement).toBe(outside)
})

test('pointer selection keeps input focus until click and closes using the original profile index', () => {
  const {input, select, trigger} = mount(profiles(3))
  filter(input, 'worker-00002')
  const option = host.querySelector('[role="option"]')!
  const down = new MouseEvent('mousedown', {bubbles: true, cancelable: true, button: 0})
  act(() => {
    option.dispatchEvent(down)
  })
  expect(down.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(input)
  act(() => {
    option.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
  expect(select).toHaveBeenCalledWith(2)
  expect(document.activeElement).toBe(trigger)
})

test('the real toolbar opens on click and pointer transitions through the gap do not dismiss it', () => {
  const state = new ProfileGroupAtom(null, 'chooser-test')
  const list = Array.from({length: 3}, (_, i) => {
    const builder = new CallTreeProfileBuilder()
    builder.setName(`thread-${i}`)
    return builder.build()
  })
  state.setProfileGroup({name: 'capture', indexToView: 0, profiles: list})
  const select = jest.fn()
  act(() =>
    render(
      <Toolbar
        {...({
          profileGroup: state.get(),
          activeProfileState: {...state.getActiveProfile(), index: 0},
          setProfileIndexToView: select,
          viewMode: ViewMode.LEFT_HEAVY_FLAME_GRAPH,
          loading: false,
          browseForFile: jest.fn(),
          saveFile: jest.fn(),
        } as any)}
      />,
      host,
    ),
  )
  const trigger = host.querySelector<HTMLButtonElement>('[aria-controls="profile-select-options"]')!
  act(() => {
    trigger.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}))
  })
  expect(host.querySelector('[role="combobox"]')).toBeNull()
  // .click() deliberately does not focus the trigger in JSDOM. The chooser
  // still needs to return focus to that real trigger, not document.body.
  act(() => trigger.click())
  const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
  expect(document.activeElement).toBe(input)
  act(() => {
    trigger.dispatchEvent(new MouseEvent('mouseleave', {relatedTarget: document.body}))
    trigger.parentElement!.dispatchEvent(
      new MouseEvent('mouseleave', {relatedTarget: document.body}),
    )
    input.dispatchEvent(new MouseEvent('mouseenter', {relatedTarget: trigger}))
  })
  expect(host.querySelector('[role="combobox"]')).toBe(input)
  key(input, 'ArrowDown')
  key(input, 'Enter')
  expect(select).toHaveBeenCalledWith(1)
  expect(host.querySelector('[role="combobox"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  act(() => trigger.click())
  key(host.querySelector('[role="combobox"]')!, 'Escape')
  expect(document.activeElement).toBe(trigger)
})

test('explicit close survives automatic blur before cleanup in a mounted hidden parent', () => {
  const items = profiles(3)
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button type="button" aria-controls="profile-select-options" onClick={() => setOpen(true)}>
          Trigger
        </button>
        <div style={{display: open ? 'block' : 'none'}}>
          <ProfileSelect
            profiles={items}
            indexToView={0}
            visible={open}
            setProfileIndexToView={() => {}}
            closeProfileSelect={() => {
              // Emulate browsers which blur descendants when display:none is
              // applied, before Preact runs the child's effect cleanup.
              const field = host.querySelector<HTMLInputElement>('[role="combobox"]')
              if (document.activeElement === field) field?.blur()
              setOpen(false)
            }}
          />
        </div>
      </div>
    )
  }
  act(() => render(<Harness />, host))
  const trigger = host.querySelector('button')!
  for (const action of ['Escape', 'Enter', 'Close']) {
    act(() => trigger.click())
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
    if (action === 'Close')
      act(() =>
        Array.from(host.querySelectorAll('button'))
          .find(b => b.textContent === 'Close')!
          .click(),
      )
    else key(input, action)
    expect(host.querySelector('[role="combobox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  }
})
