jest.mock('../import/profile-loader', () => ({
  importProfileFile: jest.fn(),
  wereSymbolsLoaded: () => true,
}))
jest.mock('./profile-comparison-graph', () => ({ProfileComparisonGraph: () => null}))
import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {ProfileComparisonDialog} from './profile-comparison-dialog'
import {importProfileFile} from '../import/profile-loader'
import {Profile, StackListProfileBuilder} from '../lib/profile'
import {TimeFormatter} from '../lib/value-formatters'
import {exportProfileGroup} from '../lib/file-format'
import {Toolbar} from './toolbar'
import {ProfileGroupAtom} from '../app-state/profile-group'
import {ViewMode} from '../lib/view-mode'

let host: HTMLDivElement
const mockedImport = importProfileFile as jest.Mock
beforeEach(() => {
  mockedImport.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(async () => {
  act(() => render(null, host))
  host.remove()
  await new Promise(resolve => setTimeout(resolve, 0))
})
function profile(name: string, weight = 1, count = 1, time = false): Profile {
  const builder = new StackListProfileBuilder()
  builder.setName(name)
  if (time) builder.setValueFormatter(new TimeFormatter('nanoseconds'))
  for (let i = 0; i < count; i++) {
    builder.appendSampleWithWeight(
      [{key: i, name: `work-${i}`, file: 'app.js', line: i + 1}],
      weight,
    )
  }
  return builder.build()
}
function mount(profiles: Profile[], initialIndex = 0, onClose = jest.fn()) {
  act(() =>
    render(
      <ProfileComparisonDialog profiles={profiles} initialIndex={initialIndex} onClose={onClose} />,
      host,
    ),
  )
}
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
function click(text: string) {
  act(() => button(text).click())
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve, 0))
  })
}
function change(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', {bubbles: true}))
  })
}
function chooseFile(name = 'candidate.json') {
  const field = host.querySelector<HTMLInputElement>('input[type="file"]:not([aria-label])')!
  Object.defineProperty(field, 'files', {
    configurable: true,
    value: {item: () => new File(['{}'], name)},
  })
  act(() => {
    field.dispatchEvent(new Event('change', {bubbles: true}))
  })
}
function row(name: string) {
  return Array.from(host.querySelectorAll('tbody tr')).find(
    item => item.querySelector('button')?.textContent === name,
  )!
}

test('compares real loaded profiles with signed totals without changing either recording', async () => {
  const profiles = [profile('before', 2), profile('after', 7)]
  const before = exportProfileGroup({name: 'loaded', indexToView: 0, profiles})
  mount(profiles)
  click('Compare')
  await settle()
  expect(row('work-0').textContent).toContain('+5')
  expect(host.textContent).toContain('Compared 2 call paths.')
  const baseline = host.querySelectorAll('fieldset select')[0] as HTMLSelectElement
  const candidate = host.querySelectorAll('fieldset select')[1] as HTMLSelectElement
  change(baseline, '1')
  change(candidate, '0')
  click('Compare')
  await settle()
  expect(row('work-0').textContent).toContain('-5')
  expect(exportProfileGroup({name: 'loaded', indexToView: 0, profiles})).toEqual(before)
})

test('different units show an actionable error and normalized comparison uses percentage points', async () => {
  mount([profile('counts', 2), profile('time', 7, 1, true)])
  click('Compare')
  await settle()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('matching units')
  const scaling = Array.from(host.querySelectorAll('select')).find(item =>
    item.querySelector('option[value="normalized"]'),
  )!
  change(scaling, 'normalized')
  click('Compare')
  await settle()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(row('work-0').textContent).toContain('100.00%')
  expect(row('work-0').textContent).toContain('0.00 pp')
})

test('profile choices, call-path pages and search results stay bounded', async () => {
  const profiles = Array.from({length: 250}, (_, index) =>
    profile(`recording-${index}`, 1, index === 249 ? 250 : 1),
  )
  mount(profiles, 249)
  const choices = host.querySelectorAll('fieldset select')
  expect(choices[0].querySelectorAll('option').length).toBeLessThanOrEqual(101)
  expect(choices[1].querySelectorAll('option').length).toBeLessThanOrEqual(101)
  const filter = host.querySelector('fieldset input') as HTMLInputElement
  act(() => {
    filter.value = 'recording-1'
    filter.dispatchEvent(new Event('input', {bubbles: true}))
  })
  expect(choices[0].querySelectorAll('option')).toHaveLength(101)
  expect(choices[0].querySelector('option')!.textContent).toContain('Selected: recording-249')
  click('Compare')
  await settle()
  expect(host.querySelectorAll('tbody tr')).toHaveLength(100)
  click('Next call paths')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(100)
  const search = Array.from(host.querySelectorAll('form'))[0]
  const query = search.querySelector('input')!
  act(() => {
    query.value = 'work-'
    query.dispatchEvent(new Event('input', {bubbles: true}))
  })
  act(() => {
    search.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  await settle()
  expect(host.textContent).toContain('Only the first 100 matches are shown')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(100)
  expect(button('Next call paths').disabled).toBe(true)
})

test('imports a candidate separately and ignores its result after cancellation', async () => {
  let resolveImport!: (group: any) => void
  mockedImport.mockImplementation(
    () =>
      new Promise(resolve => {
        resolveImport = resolve
      }),
  )
  mount([profile('baseline')])
  chooseFile()
  const signal = mockedImport.mock.calls[0][1].signal as AbortSignal
  click('Cancel work')
  expect(signal.aborted).toBe(true)
  resolveImport({name: 'late', profiles: [profile('late candidate')]})
  await settle()
  expect(host.textContent).not.toContain('late candidate')
  expect(host.textContent).toContain('Candidate recording: Loaded recording')
})

test('explicit differential import compares its two columns and can restore the loaded recording', async () => {
  const original = profile('original', 100)
  const before = exportProfileGroup({name: 'original', indexToView: 0, profiles: [original]})
  mockedImport.mockResolvedValueOnce({profiles: [profile('Baseline', 8), profile('Candidate', 3)]})
  mount([original])
  const field = host.querySelector<HTMLInputElement>('[aria-label="Differential folded file"]')!
  Object.defineProperty(field, 'files', {
    value: {item: () => new File(['work 8 3'], 'diff.folded')},
  })
  act(() => {
    field.dispatchEvent(new Event('change', {bubbles: true}))
  })
  await settle()
  expect(mockedImport.mock.calls[0][0].name).toBe('diff.folded.diff.folded')
  expect(host.querySelectorAll('fieldset')[0].textContent).toContain('Baseline')
  expect(host.querySelectorAll('fieldset')[1].textContent).toContain('Candidate')
  click('Compare')
  await settle()
  expect(row('work-0').textContent).toContain('-5')
  expect(exportProfileGroup({name: 'original', indexToView: 0, profiles: [original]})).toEqual(
    before,
  )
  click('Use loaded recording')
  expect(host.querySelectorAll('fieldset')[0].textContent).toContain('original')
  expect(host.querySelectorAll('fieldset select')[0].textContent).not.toContain('Baseline')
})

test('successful external import compares without replacing the baseline and Escape aborts a later load', async () => {
  mockedImport.mockResolvedValueOnce({
    name: 'external',
    profiles: [profile('external candidate', 4)],
  })
  const onClose = jest.fn()
  mount([profile('baseline')], 0, onClose)
  chooseFile()
  await settle()
  expect(host.textContent).toContain('Candidate recording: candidate.json')
  expect(host.querySelectorAll('fieldset')[0].textContent).toContain('baseline')
  click('Compare')
  await settle()
  expect(row('work-0').textContent).toContain('+3')
  mockedImport.mockImplementation(() => new Promise(() => {}))
  chooseFile('pending.json')
  const signal = mockedImport.mock.calls[1][1].signal as AbortSignal
  act(() => {
    host.querySelector('dialog')!.dispatchEvent(new Event('cancel', {cancelable: true}))
  })
  expect(signal.aborted).toBe(true)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('toolbar closes and aborts comparison when the underlying profile model changes', async () => {
  mockedImport.mockImplementation(() => new Promise(() => {}))
  const atom = new ProfileGroupAtom(null, 'comparison-test')
  atom.setProfileGroup({name: 'original', indexToView: 0, profiles: [profile('original')]})
  const props = {
    profileGroup: atom.get(),
    activeProfileState: {...atom.getActiveProfile(), index: 0},
    viewMode: ViewMode.CALL_TREE,
    loading: false,
    browseForFile: jest.fn(),
    saveFile: jest.fn(),
    setProfileGroup: jest.fn(),
  } as any
  act(() => render(<Toolbar {...props} />, host))
  change(host.querySelector('select[aria-label="Profile actions"]')!, 'compare')
  chooseFile()
  const signal = mockedImport.mock.calls[0][1].signal as AbortSignal
  atom.setProfileGroup({name: 'replacement', indexToView: 0, profiles: [profile('replacement')]})
  act(() =>
    render(
      <Toolbar
        {...props}
        profileGroup={atom.get()}
        activeProfileState={{...atom.getActiveProfile(), index: 0}}
      />,
      host,
    ),
  )
  await settle()
  expect(signal.aborted).toBe(true)
  expect(host.querySelector('dialog')).toBeNull()
})
