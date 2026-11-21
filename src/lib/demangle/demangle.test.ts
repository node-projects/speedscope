import {loadDemangling} from './demangle'

test('demangle', async () => {
  const demangle = await loadDemangling()

  expect(demangle('a')).toBe('a')
  expect(demangle('someUnobfuscatedFunction')).toBe('someUnobfuscatedFunction')

  // C++ mangling
  expect(demangle('__ZNK7Support6ColorFeqERKS0_')).toBe(
    'Support::ColorF::operator==(Support::ColorF const&) const',
  )
  // Running a second time to test the cache
  expect(demangle('__ZNK7Support6ColorFeqERKS0_')).toBe(
    'Support::ColorF::operator==(Support::ColorF const&) const',
  )

  // Rust v0 mangling
  expect(demangle('_RNvCskwGfYPst2Cb_3foo16example_function')).toBe('foo::example_function')

  // Rust legacy mangling
  expect(demangle('_ZN3std2fs8Metadata7created17h8df207f105c5d474E')).toBe(
    'std::fs::Metadata::created::h8df207f105c5d474',
  )

  // False positive
  expect(demangle('_ZoomIn')).toBe('_ZoomIn')
})

test('loaded wrappers share their implementation cache while failure observers and default quotas remain local', async () => {
  const native = jest.fn((_name: string): string => {
    throw new Error('native failure')
  })
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  jest.doMock('./demangle.wasm', () => ({
    __esModule: true,
    default: () => Promise.resolve({wasm_demangle: native}),
  }))
  try {
    jest.resetModules()
    const load: typeof loadDemangling = require('./demangle').loadDemangling
    const firstObserver = jest.fn(),
      secondObserver = jest.fn()
    const first = await load(firstObserver),
      second = await load(secondObserver)
    expect(first('bad')).toBe('bad')
    expect(second('bad')).toBe('bad')
    expect(native).toHaveBeenCalledTimes(1)
    expect(firstObserver.mock.calls).toEqual([['bad']])
    expect(secondObserver.mock.calls).toEqual([['bad']])
    expect(warn).not.toHaveBeenCalled()
    const firstDefault = await load(),
      secondDefault = await load()
    for (let index = 0; index < 10; index++) firstDefault('bad')
    for (let index = 0; index < 10; index++) secondDefault('bad')
    expect(native).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(4)
    expect(warn.mock.calls.every(call => call.length === 1 && typeof call[0] === 'string')).toBe(
      true,
    )
  } finally {
    jest.dontMock('./demangle.wasm')
    jest.resetModules()
    warn.mockRestore()
  }
})
