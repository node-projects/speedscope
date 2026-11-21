import {
  createFunctionLink,
  parseFunctionSelection,
  resolveFunctionSelection,
  rememberFunctionLinkSource,
} from './function-link'
import {getHashParams} from './hash-params'
import {StackListProfileBuilder} from './profile'
import {ViewMode} from './view-mode'

function profile(key: number = 1, file = 'a+&.ts') {
  const builder = new StackListProfileBuilder()
  builder.setName('thread + & ☃')
  builder.appendSampleWithWeight([{key, name: 'run + & ☃', file, line: 4, col: 2}], 3)
  return builder.build()
}

test('function links restore source identity despite importer-assigned key changes', () => {
  const original = profile(),
    reopened = profile(987)
  const frame = [...original.getFrames()][0]
  rememberFunctionLinkSource([original], 'https://example.org/x?key=a+b')
  const link = createFunctionLink(
    'https://example.org/app/#profileURL=https%3A%2F%2Fexample.org%2Fx%3Fkey%3Da%2Bb&title=Hello%20world&localProfilePath=secret',
    [original],
    0,
    frame,
  )
  const params = getHashParams(new URL(link).hash)
  expect(params.profileURL).toBe('https://example.org/x?key=a+b')
  expect(params.title).toBe('Hello world')
  expect(params.localProfilePath).toBeUndefined()
  expect(params.viewMode).toBe(ViewMode.SANDWICH_VIEW)
  expect(resolveFunctionSelection([reopened], params.selection!)!.key).toBe(987)
})

test('links retain literal plus signs but do not reuse a previous recording URL', () => {
  const remote = profile(),
    local = profile(2)
  rememberFunctionLinkSource([remote], 'https://example.org/a+b', 'application/json')
  const url = 'https://example.org/#profileURL=https://example.org/a+b&title=Hello+world'
  const original = getHashParams(
    new URL(createFunctionLink(url, [remote], 0, [...remote.getFrames()][0])).hash,
  )
  expect(original.profileURL).toBe('https://example.org/a+b')
  expect(original.title).toBe('Hello+world')
  expect(original.profileAccepts).toBe('application/json')
  const replacement = getHashParams(
    new URL(createFunctionLink(url, [local], 0, [...local.getFrames()][0])).hash,
  )
  expect(replacement.profileURL).toBeUndefined()
  expect(replacement.profileAccepts).toBeUndefined()
})

test('wrong profile metadata, source file and ambiguous identities never pick another frame', () => {
  const p = profile()
  const selection = getHashParams(
    new URL(createFunctionLink('https://example.org/', [p], 0, [...p.getFrames()][0])).hash,
  ).selection!
  expect(resolveFunctionSelection([profile(2, 'other.ts')], selection)).toBeNull()
  expect(resolveFunctionSelection([p], {...selection, profileIndex: 1})).toBeNull()
  expect(resolveFunctionSelection([p], {...selection, profileName: 'other'})).toBeNull()
  expect(resolveFunctionSelection([p], {...selection, totalWeight: 4})).toBeNull()
  const duplicate = new StackListProfileBuilder()
  duplicate.setName(p.getName())
  duplicate.appendSampleWithWeight([{...selection.frame, key: 1}], 1)
  duplicate.appendSampleWithWeight([{...selection.frame, key: 2}], 2)
  expect(resolveFunctionSelection([duplicate.build()], selection)).toBeNull()
})

test('derived profiles, oversized identities and non-HTTP remote inputs are handled explicitly', () => {
  const p = profile(),
    frame = [...p.getFrames()][0]
  for (const remote of ['data:application/json,secret', 'file:///secret/path']) {
    const link = createFunctionLink(
      'https://example.org/#profileURL=' + encodeURIComponent(remote),
      [p],
      0,
      frame,
    )
    expect(getHashParams(new URL(link).hash).profileURL).toBeUndefined()
  }
  expect(() =>
    createFunctionLink('https://example.org/', [p], 0, {...frame, name: 'x'.repeat(8193)}),
  ).toThrow('too long')
  p.setDerived(true)
  expect(() => createFunctionLink('https://example.org/', [p], 0, frame)).toThrow(
    'original profile',
  )
})

test('selection input is versioned, bounded and rejects malformed source positions', () => {
  const p = profile(),
    frame = [...p.getFrames()][0]
  const value = getHashParams(
    new URL(createFunctionLink('https://example.org/', [p], 0, frame)).hash,
  ).selection!
  for (const invalid of [
    null,
    {...value, v: 2},
    {...value, profileIndex: -1},
    {...value, frame: {...value.frame, line: -1}},
    {...value, frame: {...value.frame, file: 1}},
    {...value, totalWeight: null},
  ]) {
    expect(parseFunctionSelection(JSON.stringify(invalid))).toBeUndefined()
  }
  expect(parseFunctionSelection('x'.repeat(8193))).toBeUndefined()
  expect(getHashParams('#selection=' + encodeURIComponent('{broken'))).toEqual({})
})
