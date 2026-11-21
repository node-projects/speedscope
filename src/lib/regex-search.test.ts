import {RE2JS} from 're2js'
import {
  createTextMatcher,
  getSearchQueryError,
  ProfileSearchResults,
  SearchMode,
} from './profile-search'
import {compileSearchRegex} from './regex-search'
import {StackListProfileBuilder} from './profile'
import {searchProfiles} from './multi-profile-search'

test('regex searches names and files case-insensitively with UTF-16 highlight offsets', async () => {
  const matcher = createTextMatcher('task\\d+|worker', SearchMode.REGEX)
  expect(matcher.hasMatch('prefix_TASK42_suffix')).toBe(true)
  expect(matcher.ranges('😀TASK42 and WORKER')).toEqual([
    [2, 8],
    [13, 19],
  ])
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 1, name: 'unrelated', file: 'src/TASK7.ts'}], 8)
  const profile = builder.build()
  const results = new ProfileSearchResults(profile, 'task\\d+', SearchMode.REGEX)
  const frame = Array.from(profile.getFrames())[0]
  expect(results.hasMatchForFrame(frame)).toBe(true)
  expect(results.getMatchForFrame(frame)).toEqual([])
  expect(
    (await searchProfiles([profile], 'task\\d+', {mode: SearchMode.REGEX})).matches,
  ).toHaveLength(1)
  expect(profile.getTotalWeight()).toBe(8)
})

test('matches complete long symbols, including their tail, without truncation', () => {
  const name = 'a'.repeat(1_000_000) + 'tail'
  const matcher = createTextMatcher('tail$', SearchMode.REGEX)
  expect(matcher.hasMatch(name)).toBe(true)
  expect(matcher.ranges(name, 64)).toEqual([[1_000_000, 1_000_004]])
  expect(createTextMatcher('(a+)+$', SearchMode.REGEX).hasMatch('a'.repeat(100_000) + '!')).toBe(
    false,
  )
})

test('zero-width patterns select matching frames but highlight no nonexistent characters', () => {
  const matcher = createTextMatcher('^|$', SearchMode.REGEX)
  expect(matcher.hasMatch('hello')).toBe(true)
  expect(matcher.ranges('hello', 64)).toEqual([])
  expect(createTextMatcher('a*', SearchMode.REGEX).ranges('bbb', 2)).toEqual([])
})

test('highlights stop at the existing drawing budget', () => {
  expect(createTextMatcher('a', SearchMode.REGEX).ranges('a'.repeat(100000), 64)).toHaveLength(64)
})

test('rejects excessive counted expansions before invoking the dependency compiler', () => {
  const compile = jest.spyOn(RE2JS, 'compile')
  try {
    for (const pattern of [
      'a{999999999}',
      '(a{100}){100}',
      '(abcdefghijklmnop){300}',
      'a'.repeat(257),
    ]) {
      expect(() => compileSearchRegex(pattern)).toThrow()
    }
    expect(compile).not.toHaveBeenCalled()
  } finally {
    compile.mockRestore()
  }
  expect(compileSearchRegex('a{1000}').test('a'.repeat(1000))).toBe(true)
})

test('literal character classes and escapes do not become repetition budgets', () => {
  expect(compileSearchRegex('[{}0-9]{2}').test('{9')).toBe(true)
  expect(compileSearchRegex('\\{999999\\}').test('{999999}')).toBe(true)
  expect(compileSearchRegex('\\p{Greek}+').test('αβγ')).toBe(true)
  expect(compileSearchRegex('\\Q{999999}(literal)\\E').test('{999999}(literal)')).toBe(true)
  expect(compileSearchRegex('\\x{1F600}task').matcher('😀task').find()).toBe(true)
})

test('unsupported syntax reports an error rather than falling back to native backtracking', async () => {
  for (const pattern of ['[', '(a)\\1', 'a(?=b)', '(?<=a)b']) {
    expect(getSearchQueryError(pattern, SearchMode.REGEX)).not.toBeNull()
    expect(() => createTextMatcher(pattern, SearchMode.REGEX)).toThrow()
  }
  await expect(searchProfiles([], '[', {mode: SearchMode.REGEX})).rejects.toThrow()
  expect(getSearchQueryError('[', SearchMode.SUBSTRING)).toBeNull()
  expect(createTextMatcher('[', SearchMode.SUBSTRING).hasMatch('[')).toBe(true)
})

test('bounded repetitions are checked inside inline flag groups and nesting', () => {
  expect(() => compileSearchRegex('(?i:(ab){100}){100}')).toThrow()
  expect(compileSearchRegex('(?i:ab){2}').test('ABab')).toBe(true)
})
