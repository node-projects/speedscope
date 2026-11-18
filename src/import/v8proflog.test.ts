import {checkProfileSnapshot} from '../lib/test-utils'
import {importFromV8ProfLog} from './v8proflog'

test('importFromV8ProfLog', async () => {
  await checkProfileSnapshot('./sample/profiles/node/8.5.0/simple.v8log.json')
})

test('V8 JS source coordinates preserve Windows paths, URLs, spaces and Unicode method names', () => {
  const sources = [
    ['get β.方法', 'C:\\project files\\app.js', 12, 3],
    ['async render', 'https://example.com/build files/app.js', 42, 8],
    ['', '/project files/app.js', 1, 2],
    ['run', 'node:internal/modules/cjs/loader', 99, 4],
  ] as const
  const profile = importFromV8ProfLog({
    code: sources.map(([name, file, line, col]) => ({
      type: 'JS',
      name: `${name} ${file}:${line}:${col}`,
    })),
    functions: [],
    ticks: sources.map((_, i) => ({tm: (i + 1) * 1000, vm: 0, s: [i, -1]})),
  })
  const found: any[] = []
  profile.forEachFrame(frame => found.push([frame.file, frame.line, frame.col, frame.name]))
  for (const [name, file, line, col] of sources) {
    const frame = found.find(frame => frame[0] === file)
    expect(frame.slice(0, 3)).toEqual([file, line, col])
    if (name) expect(frame[3]).toBe(name)
    else expect(frame[3]).toContain('(anonymous')
  }
})
