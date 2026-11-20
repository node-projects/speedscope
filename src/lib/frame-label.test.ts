import {frameLabel, labelMatchRanges} from './frame-label'

test('compact labels shorten path-like names only when enabled', () => {
  for (const name of [
    '/project/src/main.ts',
    'C:\\project\\main.ts',
    './src/main.ts',
    'src/main.ts',
  ]) {
    expect(frameLabel(name, true).text).toBe('main.ts')
    expect(frameLabel(name, false)).toEqual({text: name, offset: 0})
  }
  for (const name of [
    'operator/ (int)',
    'Foo::operator/',
    'Function (file/path.ts)',
    'plain',
    '/trailing/',
  ]) {
    expect(frameLabel(name, true)).toEqual({text: name, offset: 0})
  }
  expect(frameLabel('https://example.org/src/main.ts?target=a/b#fragment', true).text).toBe(
    'main.ts?target=a/b#fragment',
  )
})

test('search ranges intersect the visible suffix using UTF-16 offsets', () => {
  const label = frameLabel('/😀/src/main.ts', true)
  expect(label).toEqual({text: 'main.ts', offset: 8})
  expect(
    labelMatchRanges(
      [
        [1, 3],
        [6, 10],
        [10, 15],
      ],
      label,
    ),
  ).toEqual([
    [0, 2],
    [2, 7],
  ])
  expect(labelMatchRanges([[0, 5]], label)).toEqual([])
})
