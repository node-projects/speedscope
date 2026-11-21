jest.mock('../lib/linked-source-map', () => ({previewLinkedSourceMap: jest.fn()}))
import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {LinkedSourceMapDialog} from './linked-source-map-dialog'
import {previewLinkedSourceMap} from '../lib/linked-source-map'
import {StackListProfileBuilder} from '../lib/profile'
import {Toolbar} from './toolbar'
import {ProfileGroupAtom} from '../app-state/profile-group'
import {ViewMode} from '../lib/view-mode'

const mockedPreview = previewLinkedSourceMap as jest.Mock
let host: HTMLDivElement
beforeEach(() => {
  mockedPreview.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(async () => {
  act(() => render(null, host))
  host.remove()
  await new Promise(resolve => setTimeout(resolve, 0))
})
function profile() {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [{key: 1, name: 'run', file: 'https://example.com/app.js', line: 1, col: 1}],
    2,
  )
  return builder.build()
}
const settle = async () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
const button = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(element => element.textContent === text)!
function submit() {
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
}

test('opening the dialog performs no request; successful preview requires explicit Apply', async () => {
  const remapper = jest.fn(),
    onApply = jest.fn(),
    onClose = jest.fn()
  mockedPreview.mockResolvedValue({
    generatedURL: 'https://example.com/app.js',
    mapURL: 'https://example.com/app.map',
    changedFrames: 2,
    remapper,
  })
  act(() =>
    render(
      <LinkedSourceMapDialog
        profiles={[profile()]}
        initialURL="https://example.com/app.js"
        onClose={onClose}
        onApply={onApply}
      />,
      host,
    ),
  )
  expect(mockedPreview).not.toHaveBeenCalled()
  expect(button('Apply source map').disabled).toBe(true)
  submit()
  await settle()
  expect(host.textContent).toContain('2 frames will change')
  expect(onApply).not.toHaveBeenCalled()
  act(() => button('Apply source map').click())
  expect(onApply).toHaveBeenCalledWith(remapper)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('cancel and Escape abort pending loads without applying a partial result', async () => {
  let pendingSignal: AbortSignal | undefined
  mockedPreview.mockImplementation(
    (_profiles, _url, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        pendingSignal = signal
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      }),
  )
  const onApply = jest.fn(),
    onClose = jest.fn()
  act(() =>
    render(
      <LinkedSourceMapDialog
        profiles={[profile()]}
        initialURL="https://example.com/app.js"
        onClose={onClose}
        onApply={onApply}
      />,
      host,
    ),
  )
  submit()
  act(() => button('Cancel load').click())
  await settle()
  expect(pendingSignal!.aborted).toBe(true)
  expect(host.textContent).toContain('cancelled')
  expect(button('Apply source map').disabled).toBe(true)
  submit()
  act(() => {
    host.querySelector('dialog')!.dispatchEvent(new Event('cancel', {cancelable: true}))
  })
  await settle()
  expect(pendingSignal!.aborted).toBe(true)
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onApply).not.toHaveBeenCalled()
})

test('preview errors remain in the dialog and editing its URL invalidates a loaded preview', async () => {
  const onApply = jest.fn()
  mockedPreview.mockRejectedValueOnce(new Error('Server must permit CORS')).mockResolvedValueOnce({
    generatedURL: 'https://example.com/app.js',
    mapURL: 'https://example.com/app.map',
    changedFrames: 1,
    remapper: () => null,
  })
  act(() =>
    render(
      <LinkedSourceMapDialog
        profiles={[profile()]}
        initialURL="https://example.com/app.js"
        onClose={() => {}}
        onApply={onApply}
      />,
      host,
    ),
  )
  submit()
  await settle()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('CORS')
  submit()
  await settle()
  expect(button('Apply source map').disabled).toBe(false)
  act(() => {
    const input = host.querySelector('input')!
    input.value = 'https://example.com/other.js'
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
  expect(button('Apply source map').disabled).toBe(true)
  expect(onApply).not.toHaveBeenCalled()
})

test('toolbar invalidates pending source-map work when the imported profile models change', async () => {
  let pendingSignal: AbortSignal | undefined
  mockedPreview.mockImplementation(
    (_profiles, _url, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        pendingSignal = signal
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      }),
  )
  const atom = new ProfileGroupAtom(null, 'test')
  atom.setProfileGroup({name: 'original', indexToView: 0, profiles: [profile()]})
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
  act(() => {
    const actions = host.querySelector<HTMLSelectElement>('select[aria-label="Profile actions"]')!
    actions.value = 'linked-source-map'
    actions.dispatchEvent(new Event('change', {bubbles: true}))
  })
  expect(host.querySelector('dialog')).not.toBeNull()
  submit()
  atom.setProfileGroup({name: 'new import', indexToView: 0, profiles: [profile()]})
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
  expect(host.querySelector('dialog')).toBeNull()
  expect(pendingSignal!.aborted).toBe(true)
  expect(props.setProfileGroup).not.toHaveBeenCalled()
})
