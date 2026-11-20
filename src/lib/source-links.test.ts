import {
  defaultSourceLinkConfig as defaults,
  mappedSourcePath,
  sourceLink,
  validateSourceLinkConfig,
} from './source-links'

test('editor links encode local paths and preserve source coordinates', () => {
  expect(sourceLink({file: 'C:\\work\\a #雪.ts', line: 12, col: 3}, defaults)).toBe(
    'vscode://file/C:/work/a%20%23%E9%9B%AA.ts:12:3',
  )
  expect(sourceLink({file: '/work/a?%.ts'}, {...defaults, editor: 'vscode-insiders'})).toBe(
    'vscode-insiders://file/work/a%3F%25.ts:1:1',
  )
  expect(sourceLink({file: 'file:///C:/work/a%20b.ts', line: 0, col: -1}, defaults)).toBe(
    'vscode://file/C:/work/a%20b.ts:1:1',
  )
  expect(sourceLink({file: '\\\\server\\share\\main.ts'}, defaults)).toBe(
    'vscode://file//server/share/main.ts:1:1',
  )
  expect(sourceLink({file: 'file://server/share/main.ts'}, defaults)).toBe(
    'vscode://file//server/share/main.ts:1:1',
  )
})

test('mapping matches complete leading segments and supports Windows case and root destinations', () => {
  const config = {...defaults, fromPrefix: '/build/app/', toPrefix: 'C:/work/app/'}
  expect(sourceLink({file: '/build/app/src/main.ts'}, config)).toBe(
    'vscode://file/C:/work/app/src/main.ts:1:1',
  )
  expect(mappedSourcePath('/build/application/main.ts', config)).toBe(null)
  expect(mappedSourcePath('c:\\BUILD\\App\\main.ts', {...config, fromPrefix: 'C:/build/app'})).toBe(
    'C:/work/app/main.ts',
  )
  expect(mappedSourcePath('/build/app/main.ts', {...config, toPrefix: '/'})).toBe('/main.ts')
  expect(
    mappedSourcePath('/build/app/main.ts', {...config, fromPrefix: '/', toPrefix: '/local'}),
  ).toBe('/local/build/app/main.ts')
  expect(mappedSourcePath('/build/app/main.ts', {...config, toPrefix: ''})).toBe('main.ts')
  expect(mappedSourcePath('/BUILD/app/main.ts', config)).toBe(null)
})

test('web templates encode file data without changing the configured host', () => {
  const config = {
    ...defaults,
    editor: 'web' as const,
    fromPrefix: '/build/app',
    template: 'https://example.org/repo/{file}#L{line}C{column}',
  }
  expect(sourceLink({file: '/build/app/src/a #?雪.ts', line: 7, col: 2}, config)).toBe(
    'https://example.org/repo/src/a%20%23%3F%E9%9B%AA.ts#L7C2',
  )
  expect(sourceLink({file: '/build/app/x.ts', line: NaN, col: Infinity}, config)).toBe(
    'https://example.org/repo/x.ts#L1C1',
  )
  expect(sourceLink({file: '//evil.example/a.ts'}, {...config, fromPrefix: ''})).toBe(
    'https://example.org/repo/evil.example/a.ts#L1C1',
  )
})

test('invalid or unavailable locations remain plain text', () => {
  for (const file of [
    undefined,
    '',
    'relative/path.ts',
    'file:///%XX',
    '\ud800',
    'x'.repeat(4097),
  ]) {
    expect(sourceLink({file}, defaults)).toBe(null)
  }
  expect(sourceLink({file: '/main.ts'}, null)).toBe(null)
})

test('web settings reject executable protocols, variable hosts, credentials and unknown tokens', () => {
  for (const template of [
    'javascript:{file}',
    'file:///{file}',
    'https://{file}/main.ts',
    'https://user:pass@example.org/{file}',
    'https://example.org/{unknown}/{file}',
    'https://example.org/main.ts',
  ]) {
    expect(() => validateSourceLinkConfig({...defaults, editor: 'web', template})).toThrow()
    expect(sourceLink({file: '/main.ts'}, {...defaults, editor: 'web', template})).toBe(null)
  }
  expect(() => validateSourceLinkConfig({...defaults, fromPrefix: 'x'.repeat(4097)})).toThrow()
  expect(() => validateSourceLinkConfig({})).toThrow()
})
