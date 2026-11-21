/** @jest-environment node */
import {readFileSync} from 'fs'
import {join} from 'path'
import {runInNewContext} from 'vm'
import createDemangler from './demangle.wasm'
import {CachedDemangler, DEMANGLE_CACHE_LIMITS} from './demangle-cache'

const wrapper = readFileSync(join(__dirname, 'demangle.post.js'), 'utf8')

function mockWrapper(failure?: 'allocate' | 'native' | 'decode' | 'free', pointer = 200) {
  const error = new Error(failure || 'unused')
  const calls: string[] = []
  const module = {wasm_demangle: (_name: string): string => ''}
  const step = (name: string, value?: unknown) => {
    calls.push(name)
    if (name === failure) throw error
    return value
  }
  runInNewContext(wrapper, {
    Module: module,
    stackSave: () => step('save', 123),
    stringToUTF8OnStack: () => step('allocate', 100),
    _demangle: () => step('native', pointer),
    UTF8ToString: () => step('decode', pointer ? 'decoded' : ''),
    _free: (result: number) => {
      expect(result).toBe(pointer)
      step('free')
    },
    stackRestore: (saved: number) => {
      expect(saved).toBe(123)
      step('restore')
    },
  })
  return {module, calls, error}
}

test('native wrapper frees its heap result and restores temporary stack storage', () => {
  const {module, calls} = mockWrapper()
  expect(module.wasm_demangle('_Z3foov')).toBe('decoded')
  expect(calls).toEqual(['save', 'allocate', 'native', 'decode', 'free', 'restore'])
  const noResult = mockWrapper(undefined, 0)
  expect(noResult.module.wasm_demangle('ordinary')).toBe('')
  expect(noResult.calls).toEqual(['save', 'allocate', 'native', 'decode', 'restore'])
})

for (const failure of ['allocate', 'native', 'decode', 'free'] as const) {
  test(`native wrapper restores its stack when ${failure} throws`, () => {
    const {module, calls, error} = mockWrapper(failure)
    expect(() => module.wasm_demangle('_Z3foov')).toThrow(error.message)
    expect(calls[calls.length - 1]).toBe('restore')
    expect(calls.filter(call => call === 'free')).toHaveLength(
      failure === 'decode' || failure === 'free' ? 1 : 0,
    )
  })
}

test('embedded native demangler survives repeated uncached calls without consuming stack', async () => {
  const module = (await createDemangler()) as Awaited<ReturnType<typeof createDemangler>> & {
    stackSave(): number
  }
  const initialStack = module.stackSave()
  // The previous artifact traps after 4,056 repetitions of this valid symbol.
  // Call the actual WASM wrapper directly: the TypeScript memoization cannot hide it.
  for (let index = 0; index < 20000; index++) {
    const result = module.wasm_demangle('_ZN3foo3barEv')
    if (result !== 'foo::bar()') throw new Error(`Wrong result at call ${index}: ${result}`)
  }
  expect(module.stackSave()).toBe(initialStack)
  expect(module.wasm_demangle('_RNvCskwGfYPst2Cb_3foo16example_function')).toBe(
    'foo::example_function',
  )
  expect(module.wasm_demangle('ordinary')).toBe('')
  expect(module.stackSave()).toBe(initialStack)
})

test('the reported large gRPC symbol leaves subsequent native calls usable', async () => {
  const module = (await createDemangler()) as Awaited<ReturnType<typeof createDemangler>> & {
    stackSave(): number
  }
  const initialStack = module.stackSave()
  const grpcSymbol = readFileSync(
    join(__dirname, '../../../sample/profiles/demangle/grpc-symbol.txt'),
    'utf8',
  ).trim()
  // The pinned libiberty declines this valid 1,252-character symbol through its
  // component-count guard. This checks wrapper lifetime, not full #508 support;
  // that decoding limitation remains in the backlog and fixture provenance.
  module.wasm_demangle(grpcSymbol)
  expect(module.wasm_demangle('_ZN3foo3barEv')).toBe('foo::bar()')
  expect(module.stackSave()).toBe(initialStack)
})

test('bounded cache eviction keeps real native decoding correct for later symbols', async () => {
  const module = await createDemangler()
  const cache = new CachedDemangler(module.wasm_demangle)
  const failure = jest.fn()
  for (let index = 0; index < 12000; index++) {
    const name = `fn${index}`
    const decoded = cache.demangle(`_Z${name.length}${name}v`, failure)
    if (decoded !== `${name}()`) throw new Error(`Wrong decoded symbol at ${index}`)
  }
  expect(cache.size).toBe(DEMANGLE_CACHE_LIMITS.entries)
  expect(cache.characterCount).toBeLessThanOrEqual(DEMANGLE_CACHE_LIMITS.characters)
  expect(cache.demangle('_Z3fn0v', failure)).toBe('fn0()')
  expect(failure).not.toHaveBeenCalled()
})
