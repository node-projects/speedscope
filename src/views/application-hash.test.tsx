jest.mock('../../assets/reset.css', () => ({}))
jest.mock('../../assets/source-code-pro.css', () => ({}))
jest.mock(
  '../../sample/profiles/stackcollapse/perf-vertx-stacks-01-collapsed-all.txt',
  () => 'example.txt',
)
import {Application} from './application'
import {StackListProfileBuilder} from '../lib/profile'
import {createFunctionLink, rememberFunctionLinkSource} from '../lib/function-link'
import {hashParamsAtom, profileGroupAtom} from '../app-state'
import {ViewMode} from '../lib/view-mode'

const originalURL = window.location.href
afterEach(() => {
  window.history.replaceState(null, '', originalURL)
  hashParamsAtom.set({})
  profileGroupAtom.set(null)
})
function fixture() {
  const builder = new StackListProfileBuilder()
  builder.setName('thread')
  builder.appendSampleWithWeight([{key: 'first', name: 'first'}], 2)
  builder.appendSampleWithWeight([{key: 'second', name: 'second'}], 3)
  const profile = builder.build()
  const group = {name: 'recording', indexToView: 0, profiles: [profile]}
  const app = new Application({
    hashParams: {},
    setViewMode: jest.fn(),
    setProfileGroup: profileGroupAtom.setProfileGroup,
    setError: jest.fn(),
    setLoading: jest.fn(),
  } as any)
  app.forceUpdate = jest.fn()
  const navigate = (key: string) => {
    const url = createFunctionLink(window.location.href, [profile], 0, profile.getFrame(key)!)
    window.history.replaceState(null, '', url)
    ;(app as any).onHashChange()
  }
  return {app, group, profile, navigate}
}

test('same-tab links select the new function without replacing the recording', () => {
  const {app, group, profile, navigate} = fixture()
  profileGroupAtom.setProfileGroup(group)
  const load = jest.spyOn(app, 'maybeLoadHashParamProfile')
  navigate('first')
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('first')
  navigate('second')
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('second')
  expect(profileGroupAtom.getActiveProfile()!.profile).toBe(profile)
  expect(hashParamsAtom.get().selection!.frame.name).toBe('second')
  expect(app.props.setViewMode).toHaveBeenLastCalledWith(ViewMode.SANDWICH_VIEW)
  expect(load).not.toHaveBeenCalled()
})

test('unresolved links preserve the model and restore after importing the original file', async () => {
  const {app, group, navigate} = fixture()
  const other = new StackListProfileBuilder()
  other.setName('other thread')
  other.appendSampleWithWeight([{key: 'other', name: 'other'}], 1)
  const otherProfile = other.build()
  profileGroupAtom.setProfileGroup({...group, profiles: [otherProfile]})
  navigate('second')
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBeNull()
  expect(profileGroupAtom.getActiveProfile()!.profile).toBe(otherProfile)
  expect((app as any).functionLinkNotice).toContain('not found uniquely')
  await (app as any).loadProfile(async () => group)
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('second')
  expect((app as any).functionLinkNotice).toBe('')
})

test('links changed during import apply to its result instead of the previous model', async () => {
  const {app, group, navigate} = fixture()
  profileGroupAtom.setProfileGroup(group)
  let finish!: (value: typeof group) => void
  const pending = (app as any).loadProfile(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  navigate('second')
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBeNull()
  finish(group)
  await pending
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('second')
})

test('changed remote source or Accept header loads while selection-only changes reuse input', () => {
  const {app, profile, group} = fixture()
  const load = jest.spyOn(app, 'maybeLoadHashParamProfile').mockResolvedValue(undefined)
  for (const hash of [
    '#profileURL=https%3A%2F%2Fexample.org%2Fa&profileAccepts=application%2Fjson',
    '#profileURL=https%3A%2F%2Fexample.org%2Fa&profileAccepts=application%2Foctet-stream',
    '#profileURL=https%3A%2F%2Fexample.org%2Fb',
  ]) {
    window.history.replaceState(null, '', hash)
    ;(app as any).onHashChange()
  }
  expect(load).toHaveBeenCalledTimes(3)
  rememberFunctionLinkSource([profile], 'https://example.org/b')
  profileGroupAtom.setProfileGroup(group)
  window.history.replaceState(null, '', '#profileURL=https%3A%2F%2Fexample.org%2Fb&view=sandwich')
  ;(app as any).onHashChange()
  expect(load).toHaveBeenCalledTimes(3)
  profileGroupAtom.set(null)
  ;(app as any).onHashChange()
  expect(load).toHaveBeenCalledTimes(4)
})

test('live view links keep aggregate recordings out of Time Order', () => {
  const {app, group, profile} = fixture()
  profile.setChronological(false)
  profileGroupAtom.setProfileGroup(group)
  window.history.replaceState(null, '', '#view=time-ordered')
  ;(app as any).onHashChange()
  expect(app.props.setViewMode).toHaveBeenLastCalledWith(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
})

test('a remote function link supersedes a pending local import even when its URL is unchanged', async () => {
  const {app, group, profile, navigate} = fixture()
  const source = {url: 'https://example.org/recording', accepts: 'application/json'}
  rememberFunctionLinkSource([profile], source.url, source.accepts)
  ;(app as any).liveHashParams = {profileURL: source.url, profileAccepts: source.accepts}
  profileGroupAtom.setProfileGroup(group)
  let finish!: (value: typeof group) => void
  const localImport = (app as any).loadProfile(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  const reload = jest.spyOn(app, 'maybeLoadHashParamProfile').mockImplementation(async () => {
    await (app as any).loadProfile(async () => group, source)
  })
  navigate('first')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('first')
  finish({...group, name: 'superseded'})
  await localImport
  expect(profileGroupAtom.get()!.name).toBe('recording')
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('first')
})

test('mounted hash navigation stops affecting the recording after unmount', () => {
  const {app, group, profile} = fixture()
  jest.spyOn(app, 'maybeLoadHashParamProfile').mockResolvedValue(undefined)
  profileGroupAtom.setProfileGroup(group)
  app.componentDidMount()
  window.history.replaceState(
    null,
    '',
    createFunctionLink(originalURL, [profile], 0, profile.getFrame('first')!),
  )
  window.dispatchEvent(new Event('hashchange'))
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('first')
  app.componentWillUnmount()
  window.history.replaceState(
    null,
    '',
    createFunctionLink(originalURL, [profile], 0, profile.getFrame('second')!),
  )
  window.dispatchEvent(new Event('hashchange'))
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe('first')
})
