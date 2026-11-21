jest.mock('../../assets/reset.css', () => ({}))
jest.mock('../../assets/source-code-pro.css', () => ({}))
jest.mock(
  '../../sample/profiles/stackcollapse/perf-vertx-stacks-01-collapsed-all.txt',
  () => 'example.txt',
)

import {Application, GLCanvas} from './application'
import {CallTreeProfileBuilder, StackListProfileBuilder, ProfileGroup} from '../lib/profile'
import {createFunctionLink} from '../lib/function-link'
import {getHashParams} from '../lib/hash-params'
import {profileGroupAtom, viewModeAtom} from '../app-state'
import * as fileFormat from '../lib/file-format'
import {ViewMode} from '../lib/view-mode'
import {MultiTrackView} from './multi-track-view'
import {CounterTrack} from '../lib/counter-track'
import {ProfileGroupAtom} from '../app-state/profile-group'

function counter(): CounterTrack {
  return {
    id: 'heap',
    name: 'Heap',
    clock: 'wall',
    timeUnit: 'microseconds',
    start: 100,
    valueUnit: 'bytes',
    times: new Float64Array([0, 1]),
    values: new Float64Array([20, 40]),
  }
}

test('counter-only captures load into Tracks without fabricated profiles and remain exportable', async () => {
  const counters = [counter()]
  const group = {name: 'Counters only', indexToView: 0, profiles: [], counterTracks: counters}
  const setViewMode = jest.fn(),
    setProfileGroup = jest.fn(),
    alert = jest.spyOn(window, 'alert')
  alert.mockImplementation(() => {})
  const app = new Application({
    hashParams: {},
    setProfileGroup,
    setViewMode,
    setError: jest.fn(),
    setLoading: jest.fn(),
    viewMode: ViewMode.CHRONO_FLAME_CHART,
  } as any)
  app.forceUpdate = jest.fn()
  const save = jest.spyOn(fileFormat, 'saveToFile')
  save.mockResolvedValue(undefined)
  try {
    await (app as any).loadProfile(async () => group)
    expect(alert).not.toHaveBeenCalled()
    expect(setProfileGroup).toHaveBeenCalledWith(group)
    expect(setViewMode).toHaveBeenLastCalledWith(ViewMode.MULTI_TRACK)
    const state = new ProfileGroupAtom(null, 'counter-only-test')
    state.setProfileGroup(group)
    expect(state.get()!.counterTracks).toBe(counters)
    state.setProfileIndexToView(10)
    expect(state.get()!.indexToView).toBe(0)
    ;(app as any).props = {
      ...app.props,
      activeProfileState: null,
      profileGroup: state.get(),
      viewMode: ViewMode.SANDWICH_VIEW,
    }
    const rendered = app.renderContent() as any
    expect(rendered.type).toBe(MultiTrackView)
    expect(rendered.props.profiles).toEqual([])
    expect(rendered.props.counterTracks).toBe(counters)
    await app.onWindowKeyPress({key: '1'} as KeyboardEvent)
    expect(setViewMode).toHaveBeenLastCalledWith(ViewMode.MULTI_TRACK)
    await (app as any).saveFile()
    expect(save.mock.calls[0][0].counterTracks).toBe(counters)
    expect(save.mock.calls[0][0].profiles).toEqual([])
  } finally {
    save.mockRestore()
    alert.mockRestore()
  }
})

test('function links restore the destination profile after loading and do not reapply to later imports', async () => {
  const builder = new StackListProfileBuilder()
  builder.setName('worker')
  builder.appendSampleWithWeight([{key: 1, name: 'run', file: 'worker.ts', line: 2}], 1)
  const profile = builder.build()
  const profiles = [new CallTreeProfileBuilder().build(), profile]
  const link = createFunctionLink('https://example.org/', profiles, 1, [...profile.getFrames()][0])
  const app = new Application({
    hashParams: getHashParams(new URL(link).hash),
    setError: jest.fn(),
    setLoading: jest.fn(),
    viewMode: ViewMode.LEFT_HEAVY_FLAME_GRAPH,
    setViewMode: (mode: ViewMode) => viewModeAtom.set(mode),
    setProfileGroup: (group: ProfileGroup) => profileGroupAtom.setProfileGroup(group),
  } as any)
  app.forceUpdate = jest.fn()
  try {
    await (app as any).loadProfile(async () => ({name: 'capture', indexToView: 0, profiles}))
    expect(viewModeAtom.get()).toBe(ViewMode.SANDWICH_VIEW)
    expect(profileGroupAtom.getActiveProfile()!.profile).toBe(profile)
    expect(
      profileGroupAtom.getActiveProfile()!.sandwichViewState.callerCallee!.selectedFrame.key,
    ).toBe(1)
    await (app as any).loadProfile(async () => ({name: 'replacement', indexToView: 0, profiles}))
    expect(profileGroupAtom.get()!.indexToView).toBe(0)
  } finally {
    profileGroupAtom.set(null)
    viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
  }
})

test('a superseded import cannot replace a newer profile or clear its loading state', async () => {
  const group = (name: string) => ({
    name,
    indexToView: 0,
    profiles: [new CallTreeProfileBuilder().build()],
  })
  let resolveOld!: (value: ReturnType<typeof group>) => void
  const old = new Promise<ReturnType<typeof group>>(resolve => {
    resolveOld = resolve
  })
  const setProfileGroup = jest.fn(),
    setLoading = jest.fn()
  const app = new Application({
    setProfileGroup,
    setLoading,
    setError: jest.fn(),
    hashParams: {},
  } as any)
  const first = (app as any).loadProfile(() => old)
  await new Promise(resolve => setTimeout(resolve, 0))
  await (app as any).loadProfile(async () => group('new'))
  resolveOld(group('old'))
  await first
  expect(setProfileGroup).toHaveBeenCalledTimes(1)
  expect(setProfileGroup.mock.calls[0][0].name).toBe('new')
  expect(setLoading.mock.calls).toEqual([[true], [true], [false]])
  expect(document.title).toBe('new - speedscope')
})

test('cancelled imports clear loading without discarding the previous profile or showing an error', async () => {
  const setError = jest.fn(),
    setLoading = jest.fn(),
    setProfileGroup = jest.fn()
  const app = new Application({setError, setLoading, setProfileGroup, hashParams: {}} as any)
  app.forceUpdate = jest.fn()
  const pending = (app as any).loadProfile(
    (options: any) =>
      new Promise((_resolve, reject) => {
        options.onProgress({phase: 'Parsing profile', canCancel: true})
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('cancelled', 'AbortError')),
        )
      }),
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  ;(app as any).importController.abort()
  await pending
  expect(setLoading.mock.calls[setLoading.mock.calls.length - 1]).toEqual([false])
  expect(setProfileGroup).not.toHaveBeenCalled()
  expect(setError.mock.calls).toEqual([[false]])
})

test('aggregate profiles cannot enter Time Order through shortcuts or profile switching', async () => {
  const builder = new CallTreeProfileBuilder()
  builder.setChronological(false)
  const setViewMode = jest.fn()
  const app = new Application({
    activeProfileState: {profile: builder.build()},
    viewMode: ViewMode.CHRONO_FLAME_CHART,
    setViewMode,
  } as any)
  expect((app as any).effectiveViewMode()).toBe(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
  await app.onWindowKeyPress({key: '1'} as KeyboardEvent)
  expect(setViewMode).toHaveBeenCalledWith(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
})

test('Tracks uses original profiles without WebGL and keeps its source list stable during selection updates', async () => {
  const profiles = [new CallTreeProfileBuilder().build(), new CallTreeProfileBuilder().build()]
  const setProfileIndexToView = jest.fn(),
    setViewMode = jest.fn()
  const app = new Application({
    activeProfileState: {profile: profiles[0], index: 0},
    profileGroup: {name: 'source', indexToView: 0, profiles: profiles.map(profile => ({profile}))},
    viewMode: ViewMode.MULTI_TRACK,
    glCanvas: null,
    setProfileIndexToView,
    setViewMode,
  } as any)
  const rendered = app.renderContent() as any
  expect(rendered.type).toBe(MultiTrackView)
  expect(rendered.props.profiles).toEqual(profiles)
  ;(app as any).props = {...app.props, profileGroup: {...app.props.profileGroup, indexToView: 1}}
  expect((app.renderContent() as any).props.profiles).toBe(rendered.props.profiles)
  rendered.props.onSelectProfile(1)
  expect(setProfileIndexToView).toHaveBeenCalledWith(1)
  expect(setViewMode).toHaveBeenCalledWith(ViewMode.CALL_TREE)
  ;(app as any).props = {...app.props, canvasContext: {}}
  rendered.props.onSelectProfile(1)
  expect(setViewMode).toHaveBeenLastCalledWith(ViewMode.CHRONO_FLAME_CHART)
  rendered.props.onSelectProfile(500)
  expect(setProfileIndexToView).toHaveBeenCalledTimes(2)
  await app.onWindowKeyPress({key: '5'} as KeyboardEvent)
  expect(setViewMode).toHaveBeenLastCalledWith(ViewMode.MULTI_TRACK)
})

test('Tracks replaces its source list when imported models change', () => {
  const original = new CallTreeProfileBuilder().build()
  const replacement = new CallTreeProfileBuilder().build()
  const app = new Application({
    activeProfileState: {profile: original, index: 0},
    profileGroup: {profiles: [{profile: original}]},
    viewMode: ViewMode.MULTI_TRACK,
  } as any)
  const before = (app.renderContent() as any).props.profiles
  ;(app as any).props = {...app.props, profileGroup: {profiles: [{profile: replacement}]}}
  const after = (app.renderContent() as any).props.profiles
  expect(after).not.toBe(before)
  expect(after).toEqual([replacement])
  ;(app as any).props = {...app.props, loading: true}
  app.renderLoadingBar = jest.fn(() => null)
  app.renderContent()
  expect((app as any).trackProfiles).toEqual([])
})

test('global view shortcuts leave native controls, editing and modified shortcuts alone', async () => {
  const setViewMode = jest.fn(),
    setFlattenRecursion = jest.fn()
  const app = new Application({setViewMode, setFlattenRecursion} as any)
  for (const tag of ['input', 'textarea', 'select']) {
    const target = document.createElement(tag)
    await app.onWindowKeyPress({key: '5', target} as unknown as KeyboardEvent)
    await app.onWindowKeyPress({key: 'r', target} as unknown as KeyboardEvent)
  }
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  const child = document.createElement('span')
  editable.appendChild(child)
  await app.onWindowKeyPress({key: '5', target: child} as unknown as KeyboardEvent)
  for (const flags of [
    {ctrlKey: true},
    {metaKey: true},
    {altKey: true},
    {isComposing: true},
    {defaultPrevented: true},
  ])
    await app.onWindowKeyPress({key: '5', ...flags} as unknown as KeyboardEvent)
  expect(setViewMode).not.toHaveBeenCalled()
  expect(setFlattenRecursion).not.toHaveBeenCalled()
  await app.onWindowKeyPress({key: '5'} as KeyboardEvent)
  expect(setViewMode).toHaveBeenCalledWith(ViewMode.MULTI_TRACK)
})

test('exports expose progress, reject duplicate starts and cancel without discarding the profile', async () => {
  const save = jest.spyOn(fileFormat, 'saveToFile')
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {})
  save.mockImplementation(
    (_group, options) =>
      new Promise((_resolve, reject) => {
        options!.onProgress!({
          profilesCompleted: 0,
          profileCount: 1,
          eventsWritten: 4096,
          framesWritten: 0,
          frameCount: 1,
        })
        options!.signal!.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        )
      }),
  )
  const group = {
    name: 'test',
    indexToView: 0,
    profiles: [{profile: new CallTreeProfileBuilder().build()}],
  }
  const app = new Application({profileGroup: group, loading: false} as any)
  app.forceUpdate = jest.fn()
  try {
    const pending = (app as any).saveFile()
    await (app as any).saveFile()
    expect(save).toHaveBeenCalledTimes(1)
    expect((app as any).exportProgress.eventsWritten).toBe(4096)
    ;(app as any).exportController.abort()
    await pending
    expect((app as any).exportProgress).toBe(null)
    expect(app.props.profileGroup).toBe(group)
    expect(alert).not.toHaveBeenCalled()
  } finally {
    jest.restoreAllMocks()
  }
})

test('a custom group title preserves thread names (#346)', async () => {
  const profiles = ['main', 'worker'].map(name => {
    const builder = new CallTreeProfileBuilder()
    builder.setName(name)
    return builder.build()
  })
  const setProfileGroup = jest.fn()
  const app = new Application({
    setError: jest.fn(),
    setLoading: jest.fn(),
    hashParams: {title: 'session'},
    setProfileGroup,
  } as any)
  await (app as any).loadProfile(async () => ({name: 'group', indexToView: 0, profiles}))
  expect(profiles.map(p => p.getName())).toEqual(['main', 'worker'])
  expect(setProfileGroup.mock.calls[0][0].name).toBe('session')
  expect(document.title).toBe('session - speedscope')
})

test('an explicit Time Order hash selection is honored even though its enum value is zero', async () => {
  const setViewMode = jest.fn()
  const app = new Application({
    setError: jest.fn(),
    setLoading: jest.fn(),
    setProfileGroup: jest.fn(),
    hashParams: {viewMode: ViewMode.CHRONO_FLAME_CHART},
    viewMode: ViewMode.LEFT_HEAVY_FLAME_GRAPH,
    setViewMode,
  } as any)
  await (app as any).loadProfile(async () => ({
    name: 'group',
    indexToView: 0,
    profiles: [new CallTreeProfileBuilder().build()],
  }))
  expect(setViewMode).toHaveBeenCalledWith(ViewMode.CHRONO_FLAME_CHART)
})

test('failed imports clear loading and retain an actionable message', async () => {
  const setLoading = jest.fn()
  const app = new Application({setError: jest.fn(), setLoading, hashParams: {}} as any)
  await (app as any).loadProfile(async () => {
    throw new Error('Invalid JSON at byte 12')
  })
  expect(setLoading.mock.calls[setLoading.mock.calls.length - 1]).toEqual([false])
  expect((app as any).loadError).toBe('Invalid JSON at byte 12')
})

test('resize reentry is bounded and exceptions do not disable later resizing (#426, #486)', () => {
  let calls = 0
  const resize = jest.fn(() => {
    calls++
    ;(canvas as any).maybeResize()
  })
  const canvas = new GLCanvas({canvasContext: {gl: {resize}}} as any)
  ;(canvas as any).container = {
    getBoundingClientRect: () => ({width: 2066.0166015625, height: 494.5209655761719}),
  }
  ;(canvas as any).maybeResize()
  expect(calls).toBe(1)
  resize.mockImplementationOnce(() => {
    throw new Error('resize failed')
  })
  expect(() => (canvas as any).maybeResize()).toThrow('resize failed')
  ;(canvas as any).maybeResize()
  expect(calls).toBe(2)
})
