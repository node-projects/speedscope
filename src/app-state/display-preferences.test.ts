import {storedPreference} from './display-preferences'

const validate = (value: unknown) => {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean')
  return value
}
afterEach(() => {
  window.localStorage.clear()
  jest.restoreAllMocks()
})

test('stored preferences validate persisted data and bind setters', () => {
  window.localStorage.setItem('test-pref', 'true')
  const atom = storedPreference('test-pref', false, validate)
  expect(atom.get()).toBe(true)
  const listener = jest.fn()
  atom.subscribe(listener)
  const set = atom.set
  set(false)
  expect(window.localStorage.getItem('test-pref')).toBe('false')
  expect(listener).toHaveBeenCalledTimes(1)
  for (const raw of ['"wrong type"', '{invalid']) {
    window.localStorage.setItem('test-pref', raw)
    expect(storedPreference('test-pref', false, validate).get()).toBe(false)
  }
})

test('blocked storage still permits preferences during the session', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const atom = storedPreference('blocked', false, validate)
  atom.set(true)
  expect(atom.get()).toBe(true)
})
