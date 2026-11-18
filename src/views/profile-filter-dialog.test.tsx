import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {ProfileFilterDialog} from './profile-filter-dialog'
import {StackListProfileBuilder} from '../lib/profile'

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
})
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0))
}
function setup() {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [
      {key: 1, name: 'app', file: 'src/app.ts'},
      {key: 2, name: 'lib', file: 'vendor/lib.ts'},
    ],
    5,
  )
  const profile = builder.build()
  const onApply = jest.fn(),
    onClose = jest.fn()
  act(() =>
    render(<ProfileFilterDialog profile={profile} onApply={onApply} onClose={onClose} />, host),
  )
  return {profile, onApply, onClose}
}
function include(value: string) {
  const field = host.querySelector('textarea')!
  act(() => {
    field.value = value
    field.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
function submit() {
  host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
}

test('filter dialog creates a derived profile and explains its aggregate denominator', async () => {
  const {profile, onApply, onClose} = setup()
  expect(host.textContent).toContain('Percentages use the retained weight')
  include('src/')
  await act(async () => {
    submit()
    await flush()
  })
  expect(onApply).toHaveBeenCalledTimes(1)
  const derived = onApply.mock.calls[0][0]
  expect(derived.getTotalWeight()).toBe(5)
  expect(derived.getGroupedCalltreeRoot().children[0].children).toHaveLength(0)
  expect(profile.getGroupedCalltreeRoot().children[0].children).toHaveLength(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('empty filters report an error without appending a profile', async () => {
  const {onApply, onClose} = setup()
  include('missing/')
  await act(async () => {
    submit()
    await flush()
  })
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('No frames remain')
  expect(onApply).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test('unmounting while filtering prevents a stale result from being published', async () => {
  const {onApply} = setup()
  include('src/')
  act(() => submit())
  act(() => render(null, host))
  await act(async () => {
    await flush()
  })
  expect(onApply).not.toHaveBeenCalled()
})

test('cancel during filtering aborts publication and stops keyboard shortcuts', async () => {
  const {onApply, onClose} = setup()
  include('src/')
  const shortcut = jest.fn()
  window.addEventListener('keypress', shortcut)
  host
    .querySelector('textarea')!
    .dispatchEvent(new KeyboardEvent('keypress', {key: 't', bubbles: true}))
  const paste = jest.fn()
  document.addEventListener('paste', paste)
  host.querySelector('textarea')!.dispatchEvent(new Event('paste', {bubbles: true}))
  document.removeEventListener('paste', paste)
  expect(paste).not.toHaveBeenCalled()
  window.removeEventListener('keypress', shortcut)
  expect(shortcut).not.toHaveBeenCalled()
  act(() => submit())
  const event = new Event('cancel', {cancelable: true})
  act(() => {
    host.querySelector('dialog')!.dispatchEvent(event)
  })
  await act(async () => {
    await flush()
  })
  expect(event.defaultPrevented).toBe(true)
  expect(onApply).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledTimes(1)
})
