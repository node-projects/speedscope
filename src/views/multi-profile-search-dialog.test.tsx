import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {MultiProfileSearchDialog} from './multi-profile-search-dialog'
import {StackListProfileBuilder} from '../lib/profile'
import {SearchMode} from '../lib/profile-search'

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
})
function setup() {
  const profiles = ['Worker A', 'Worker B'].map(name => {
    const builder = new StackListProfileBuilder()
    builder.setName(name)
    builder.appendSampleWithWeight([{key: 0, name: 'render', file: `${name}.ts`}], 5)
    return builder.build()
  })
  const onSelect = jest.fn(),
    onClose = jest.fn()
  act(() =>
    render(
      <MultiProfileSearchDialog profiles={profiles} onSelect={onSelect} onClose={onClose} />,
      host,
    ),
  )
  const input = host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
  act(() => {
    input.value = 'render'
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  return {profiles, onSelect, onClose}
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

test('regex mode reports unsupported syntax and finds ordinary results after correction', async () => {
  setup()
  const mode = host.querySelector('select')!
  const input = host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
  act(() => {
    mode.value = SearchMode.REGEX
    mode.dispatchEvent(new Event('change', {bubbles: true}))
    input.value = '(render)\\1'
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  await flush()
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  act(() => {
    input.value = '^REN(DER)$'
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  await flush()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2)
})
const submit = () =>
  host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
test('results distinguish profiles and select the original matching frame', async () => {
  const {profiles, onSelect, onClose} = setup()
  await act(async () => {
    submit()
    await flush()
  })
  const buttons = host.querySelectorAll<HTMLButtonElement>('tbody button')
  expect(buttons).toHaveLength(2)
  act(() => {
    buttons[1].click()
  })
  expect(onSelect).toHaveBeenCalledWith(
    {profileIndex: 1, profile: profiles[1], frame: profiles[1].getFrame(0)},
    'render',
    SearchMode.SUBSTRING,
  )
  expect(onClose).toHaveBeenCalledTimes(1)
})
test('cancelled or unmounted searches cannot publish partial results', async () => {
  const {onSelect} = setup()
  act(() => {
    submit()
  })
  const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    b => b.textContent === 'Cancel search',
  )!
  act(() => {
    cancel.click()
  })
  await act(async () => {
    await flush()
  })
  expect(host.querySelector('table')).toBeNull()
  expect(onSelect).not.toHaveBeenCalled()
  act(() => {
    submit()
  })
  act(() => render(null, host))
  await act(async () => {
    await flush()
  })
  expect(onSelect).not.toHaveBeenCalled()
})
