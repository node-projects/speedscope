jest.mock('../../assets/reset.css', () => ({}))
jest.mock('../../assets/source-code-pro.css', () => ({}))
jest.mock(
  '../../sample/profiles/stackcollapse/perf-vertx-stacks-01-collapsed-all.txt',
  () => 'example.txt',
)

import {Application, GLCanvas} from './application'
import {CallTreeProfileBuilder} from '../lib/profile'

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
