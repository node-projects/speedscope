import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {Toolbar} from './toolbar'
import {ViewMode} from '../lib/view-mode'
import {ProfileGroupAtom} from '../app-state/profile-group'
import {StackListProfileBuilder} from '../lib/profile'
import {InstantTrack} from '../lib/instant-track'
import {StyleSheetTestUtils} from 'aphrodite'

const points: readonly InstantTrack[] = [
  {
    id: 'events',
    name: 'Thread events',
    clock: 'wall',
    timeUnit: 'microseconds',
    start: 0,
    scope: 'thread',
    times: new Float64Array([1, 1]),
    events: [{name: 'first'}, {name: 'second', details: '<script>plain text</script>'}],
  },
]
let host: HTMLDivElement
beforeEach(() => {
  StyleSheetTestUtils.suppressStyleInjection()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
  jest.restoreAllMocks()
  StyleSheetTestUtils.clearBufferAndResumeStyleInjection()
})
function source(withProfile = false) {
  const state = new ProfileGroupAtom(null, 'instant-toolbar-test')
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 'work', name: 'work', file: 'app.ts'}], 3)
  state.setProfileGroup({
    name: 'Instant recording',
    profiles: withProfile ? [builder.build()] : [],
    indexToView: 0,
    instantTracks: points,
  })
  return {
    profileGroup: state.get(),
    activeProfileState: withProfile ? {...state.getActiveProfile(), index: 0} : null,
    viewMode: ViewMode.MULTI_TRACK,
    loading: false,
    setLoading: jest.fn(),
    setProfileGroup: jest.fn(),
    setViewMode: jest.fn(),
    saveFile: jest.fn(),
    browseForFile: jest.fn(),
  }
}
function button(label: string) {
  return Array.from(host.querySelectorAll('button')).find(item =>
    item.textContent!.includes(label),
  )!
}
test('instant-only recordings expose Tracks and export with stack-only views disabled', () => {
  const props = source()
  act(() => render(<Toolbar {...(props as any)} />, host))
  expect(host.textContent).toContain('Instant recording')
  expect(button('Tracks').disabled).toBe(false)
  for (const label of ['Time Order', 'Left Heavy', 'Sandwich', 'Call Tree'])
    expect(button(label).disabled).toBe(true)
  act(() => button('Export').click())
  expect(props.saveFile).toHaveBeenCalledTimes(1)
})
test('stack transformations preserve coincident instant observations without copying them', async () => {
  const props = source(true)
  const raf = jest.spyOn(window, 'requestAnimationFrame')
  raf.mockImplementation(callback => {
    callback(0)
    return 0
  })
  act(() => render(<Toolbar {...(props as any)} />, host))
  const actions = host.querySelector<HTMLSelectElement>('[aria-label="Profile actions"]')!
  await act(async () => {
    actions.value = 'file'
    actions.dispatchEvent(new Event('change', {bubbles: true}))
    await Promise.resolve()
  })
  expect(props.setProfileGroup).toHaveBeenCalledTimes(1)
  const group = props.setProfileGroup.mock.calls[0][0]
  expect(group.instantTracks).toBe(points)
  expect(group.instantTracks[0].times).toBe(points[0].times)
  expect(group.instantTracks[0].events).toBe(points[0].events)
  expect(group.profiles).toHaveLength(2)
})
