import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {Toolbar} from './toolbar'
import {ViewMode} from '../lib/view-mode'
import {StackListProfileBuilder} from '../lib/profile'
import {CounterTrack} from '../lib/counter-track'

const series: CounterTrack = {
  id: 'heap',
  name: 'Heap',
  clock: 'wall',
  timeUnit: 'microseconds',
  start: 0,
  valueUnit: 'bytes',
  times: new Float64Array([0, 1]),
  values: new Float64Array([10, 20]),
}
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
})
function props(profiles: any[] = []) {
  return {
    profileGroup: {name: 'Counter recording', indexToView: 0, profiles, counterTracks: [series]},
    activeProfileState: profiles.length ? {profile: profiles[0].profile, index: 0} : null,
    viewMode: ViewMode.MULTI_TRACK,
    loading: false,
    setLoading: jest.fn(),
    setProfileGroup: jest.fn(),
    setViewMode: jest.fn(),
    saveFile: jest.fn(),
    browseForFile: jest.fn(),
  }
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find(item => item.textContent!.includes(label))!

test('counter-only toolbar exposes Tracks and Export while stack-only controls stay disabled', () => {
  const source = props()
  act(() => render(<Toolbar {...(source as any)} />, host))
  expect(button('Tracks').disabled).toBe(false)
  for (const label of ['Time Order', 'Left Heavy', 'Sandwich', 'Call Tree'])
    expect(button(label).disabled).toBe(true)
  expect(host.textContent).toContain('Counter recording')
  act(() => button('Export').click())
  expect(source.saveFile).toHaveBeenCalledTimes(1)
})

test('derived stack actions retain the independent counter series', async () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 'work', name: 'work', file: 'app.ts'}], 10)
  const source = props([{profile: builder.build()}])
  act(() => render(<Toolbar {...(source as any)} />, host))
  const actions = host.querySelector<HTMLSelectElement>('[aria-label="Profile actions"]')!
  await act(async () => {
    actions.value = 'file'
    actions.dispatchEvent(new Event('change', {bubbles: true}))
    await new Promise(resolve => setTimeout(resolve, 80))
  })
  expect(source.setProfileGroup).toHaveBeenCalledTimes(1)
  const group = source.setProfileGroup.mock.calls[0][0]
  expect(group.counterTracks).toBe(source.profileGroup.counterTracks)
  expect(group.counterTracks[0].values).toBe(series.values)
  expect(group.profiles).toHaveLength(2)
})
