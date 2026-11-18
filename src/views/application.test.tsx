jest.mock('../../assets/reset.css', () => ({}))
jest.mock('../../assets/source-code-pro.css', () => ({}))
jest.mock(
  '../../sample/profiles/stackcollapse/perf-vertx-stacks-01-collapsed-all.txt',
  () => 'example.txt',
)

import {Application, GLCanvas} from './application'
import {CallTreeProfileBuilder} from '../lib/profile'
import * as fileFormat from '../lib/file-format'
import {ViewMode} from '../lib/view-mode'

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
