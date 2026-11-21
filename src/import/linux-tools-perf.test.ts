import {checkProfileSnapshot} from '../lib/test-utils'
import {withMockedFileChunkSizeForTests} from './utils'
import {StringBackedTextFileContent} from './utils'
import {importFromLinuxPerf} from './linux-tools-perf'
import {importProfileGroupFromText, importProfilesFromArrayBuffer} from '.'
import * as fs from 'fs'
import {ProfileGroup} from '../lib/profile'

describe('importFromLinuxPerf', () => {
  test('simple.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/simple.linux-perf.txt')
  })
  test('one-sample.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/one-sample.linux-perf.txt')
  })
  test('forks.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/forks.linux-perf.txt')
  })
  test('simple-with-header.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/simple-with-header.linux-perf.txt')
  })
  test('simple-with-pids.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/simple-with-pid.linux-perf.txt')
  })
  test('system-wide.linux-perf.txt', async () => {
    await checkProfileSnapshot('./sample/profiles/linux-perf/system-wide.linux-perf.txt')
  })
  test('system-wide.linux-perf.txt chunked', async () => {
    await withMockedFileChunkSizeForTests(100, async () => {
      await checkProfileSnapshot('./sample/profiles/linux-perf/system-wide.linux-perf.txt')
    })
  })
})

describe('perf script leaf-only output', () => {
  const fixture = fs.readFileSync('./sample/profiles/linux-perf/leaf-only.linux-perf.txt', 'utf8')

  test('consecutive inline samples retain symbols, thread identity and timestamp weights', () => {
    const group = importFromLinuxPerf(new StringBackedTextFileContent(fixture))!
    expect(group.profiles).toHaveLength(1)
    const profile = group.profiles[0]
    expect(profile.getName()).toBe('V8 WorkerThread pid: 41 tid: 42')
    expect(profile.getWeightUnit()).toBe('seconds')
    expect(profile.getTotalWeight()).toBe(2)
    const nodes = profile.getGroupedCalltreeRoot().children
    expect(nodes.map(n => [n.frame.name, n.frame.file, n.getTotalWeight()])).toEqual([
      ['leaf', '/work/my app', 1],
      ['??? ([unknown])', '[unknown]', 1],
    ])
    expect(nodes.every(n => n.children.length === 0)).toBe(true)
  })

  test('leaf-only counters retain event periods and separate event kinds', () => {
    const text = [
      'x 1 1.000000: 7 page-faults: 100 fault (/app)',
      'x 1 2.000000: 9 instructions: 200 cpu (/app)',
      'x 1 3.000000: 11 instructions: 200 cpu (/app)',
    ].join('\n')
    const group = importFromLinuxPerf(new StringBackedTextFileContent(text))!
    expect(group.profiles.map(p => p.getTotalWeight())).toEqual([7, 20])
    expect(group.profiles.map(p => p.getWeightUnit())).toEqual(['none', 'none'])
    expect(group.profiles.map(p => p.getName())).toEqual([
      'x tid: 1 [page-faults]',
      'x tid: 1 [instructions]',
    ])
  })

  test('a real callchain takes precedence over its inline leaf without duplicating it', () => {
    const text =
      'x 1 1.000000: cycles: 100 leaf+0x2 (/app)\n  100 leaf+0x2 (/app)\n  200 root (/app)\n'
    const profile = importFromLinuxPerf(new StringBackedTextFileContent(text))!.profiles[0]
    const root = profile.getGroupedCalltreeRoot().children[0]
    expect(root.frame.name).toBe('root')
    expect(root.children[0].frame.name).toBe('leaf')
    expect(root.children[0].children).toHaveLength(0)
    expect(profile.getTotalWeight()).toBe(1)
  })

  test('ordinary format detection and tiny CRLF byte chunks preserve leaf samples', async () => {
    const plain = await importProfileGroupFromText('unknown', fixture)
    let chunked: ProfileGroup | null = null
    await withMockedFileChunkSizeForTests(7, async () => {
      chunked = await importProfilesFromArrayBuffer(
        'unknown',
        new TextEncoder().encode(fixture.replace(/\n/g, '\r\n')).buffer,
      )
    })
    expect(plain!.profiles[0].getTotalWeight()).toBe(2)
    expect(chunked!.profiles[0].getTotalWeight()).toBe(2)
    expect([...chunked!.profiles[0].getFrames()].map(f => [f.name, f.file])).toEqual(
      [...plain!.profiles[0].getFrames()].map(f => [f.name, f.file]),
    )
  })

  test('missing or malformed inline symbols explain how to retain useful data', () => {
    for (const tail of ['', '100', '100 leaf', 'tracepoint=value']) {
      expect(() =>
        importFromLinuxPerf(new StringBackedTextFileContent(`x 1 1.000000: cycles: ${tail}\n`)),
      ).toThrow('include ip,sym,dso')
    }
  })
})
