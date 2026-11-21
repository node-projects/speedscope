/** @jest-environment node */
import {checkProfileSnapshot} from '../lib/test-utils'
import {withMockedFileChunkSizeForTests} from './utils'
import {StringBackedTextFileContent} from './utils'
import {importFromLinuxPerf} from './linux-tools-perf'
import {importProfileGroupFromText, importProfilesFromArrayBuffer} from '.'
import * as fs from 'fs'
import {ProfileGroup} from '../lib/profile'
import {exportProfileGroup} from '../lib/file-format'
import {tryImportTextProfile} from './streaming-text-profile'

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
    expect(profile.getName()).toBe('V8 WorkerThread pid: 41 tid: 42 [cycles:u]')
    expect(profile.getWeightUnit()).toBe('none')
    expect(profile.getTotalWeight()).toBe(400)
    const nodes = profile.getGroupedCalltreeRoot().children
    expect(nodes.map(n => [n.frame.name, n.frame.file, n.getTotalWeight()])).toEqual([
      ['leaf', '/work/my app', 200],
      ['??? ([unknown])', '[unknown]', 200],
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
    expect(plain!.profiles[0].getTotalWeight()).toBe(400)
    expect(chunked!.profiles[0].getTotalWeight()).toBe(400)
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

describe('perf period attribution (#393)', () => {
  const parse = (text: string) => importFromLinuxPerf(new StringBackedTextFileContent(text))!
  const sample = (time: number, type: string, period: number | null, name = 'work', thread = 1) =>
    `worker 10/${thread} [000] ${time.toFixed(6)}: ${
      period === null ? '' : period + ' '
    }${type}: 100 ${name} (/app)\n`

  test('the upstream13clockperiods count0.265306119seconds instead of30.230697seconds of gaps', () => {
    const fixture = fs.readFileSync(
      './sample/profiles/linux-perf/idle-clock-period.linux-perf.txt',
      'utf8',
    )
    const profile = parse(fixture).profiles[0]
    expect(profile.getWeightUnit()).toBe('nanoseconds')
    expect(profile.getTotalWeight()).toBe(13 * 20_408_163)
    expect(profile.isChronological()).toBe(false)
    expect(profile.getName()).toBe(
      'DiscoveryClient pid: 2609559 tid: 2614953 [cpu-clock; sampled CPU time]',
    )
    expect([...profile.getFrames()].map(frame => [frame.name, frame.getTotalWeight()])).toEqual([
      ['app.Worker.poll', 265_306_119],
    ])
  })

  test('single cpu/task-clock samples preserve nanosecond periods and never invent a one-unit sample', () => {
    const group = parse(sample(1, 'cpu-clock:u', 20_408_163) + sample(400, 'task-clock', 1_234_567))
    expect(
      group.profiles.map(profile => [
        profile.getWeightUnit(),
        profile.getTotalWeight(),
        profile.isChronological(),
      ]),
    ).toEqual([
      ['nanoseconds', 20_408_163, false],
      ['nanoseconds', 1_234_567, false],
    ])
  })

  test('explicit offcpu-time periods remain separate nanosecond blocked-time aggregates', () => {
    const group = parse(
      sample(100, 'cpu-clock', 10_000_000) +
        sample(100, 'offcpu-time', 2_000_000_000) +
        sample(0, 'offcpu-time', 3_000_000_000),
    )
    expect(
      group.profiles.map(profile => [
        profile.getWeightUnit(),
        profile.getTotalWeight(),
        profile.isChronological(),
      ]),
    ).toEqual([
      ['nanoseconds', 10_000_000, false],
      ['nanoseconds', 5_000_000_000, false],
    ])
    expect(group.profiles[1].getName()).toContain('sampled off-CPU time')
  })

  test('cycles are raw period weights, while counters without periods are explicitly sample counts', () => {
    const group = parse(
      sample(1, 'cpu_core/cycles/u', 1000) +
        sample(100, 'cpu_atom/cycles/u', 2000) +
        sample(500, 'instructions', null),
    )
    expect(
      group.profiles.map(profile => [
        profile.getWeightUnit(),
        profile.getTotalWeight(),
        profile.isChronological(),
      ]),
    ).toEqual([
      ['none', 3000, false],
      ['none', 1, false],
    ])
    expect(group.profiles[0].getName()).toContain('[cycles:u]')
    expect(group.profiles[1].getName()).toContain('sample count, period missing')
  })

  test('missing clock periods retain labeled inference separately from explicit measured periods', () => {
    const group = parse(
      sample(1, 'cpu-clock', null) +
        sample(2, 'cpu-clock', 10_000_000) +
        sample(11, 'cpu-clock', null) +
        sample(100, 'cpu-clock', 20_000_000),
    )
    expect(
      group.profiles.map(profile => [
        profile.getWeightUnit(),
        profile.getTotalWeight(),
        profile.isChronological(),
      ]),
    ).toEqual([
      ['seconds', 10, true],
      ['nanoseconds', 30_000_000, false],
    ])
    expect(group.profiles[0].getName()).toContain('inferred timeline, period missing')
  })

  test('zero periods remain zero and do not silently switch to inferred timeline weights', () => {
    const profile = parse(sample(100, 'cpu-clock', 0)).profiles[0]
    expect(profile.getTotalWeight()).toBe(0)
    expect(profile.getWeightUnit()).toBe('nanoseconds')
    expect(profile.isChronological()).toBe(false)
  })

  test('periods outside the exact integer range fail rather than silently rounding', () => {
    for (const period of ['9007199254740992', '9007199254740993', '-1', '9'.repeat(400)])
      expect(() => parse(`worker 10/1 1.000000: ${period} cpu-clock: 100 work (/app)\n`)).toThrow(
        'safe integers',
      )
    expect(parse(sample(1, 'cycles', Number.MAX_SAFE_INTEGER)).profiles[0].getTotalWeight()).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  test('streamed and generic period profiles export identical units, thread identity and totals', async () => {
    const text =
      sample(1, 'cpu-clock', 20_000_000) +
      sample(100, 'cpu-clock', 30_000_000) +
      sample(0, 'offcpu-time', 200_000_000, 'blocked', 2) +
      sample(200, 'cycles', 1234)
    const name = 'periods.linux-perf.txt'
    const expected = await importProfileGroupFromText(name, text)
    const encoded = new TextEncoder().encode(text)
    const input = new ArrayBuffer(encoded.byteLength)
    new Uint8Array(input).set(encoded)
    const actual = await tryImportTextProfile(input, name)
    expect(exportProfileGroup(actual!)).toEqual(exportProfileGroup(expected!))
  })
})
