import {TimeFormatter, ByteFormatter, RawValueFormatter} from './value-formatters'
import {axisTicks} from './axis-ticks'

describe('TimeFormatter', () => {
  test('input units milliseconds', () => {
    const f = new TimeFormatter('milliseconds')
    expect(f.format(0.00004)).toEqual('40.00ns')
    expect(f.format(0.04)).toEqual('40.00µs')
    expect(f.format(3)).toEqual('3.00ms')
    expect(f.format(2070)).toEqual('2.07s')
    expect(f.format(150000)).toEqual('2:30')
    expect(f.format(1203123)).toEqual('20:03')
  })

  test('input units seconds', () => {
    const f = new TimeFormatter('seconds')
    expect(f.format(0.00004)).toEqual('40.00µs')
    expect(f.format(0.003)).toEqual('3.00ms')
    expect(f.format(2.07)).toEqual('2.07s')
    expect(f.format(150)).toEqual('2:30')
    expect(f.format(1203.123)).toEqual('20:03')
  })
})

test('ByteFormatter', () => {
  const f = new ByteFormatter()
  expect(f.format(100)).toEqual('100 B')
  expect(f.format(1024)).toEqual('1.00 KB')
  expect(f.format(3.5 * 1024 * 1024)).toEqual('3.50 MB')
  expect(f.format(4.32 * 1024 * 1024 * 1024)).toEqual('4.32 GB')
})

test('axis precision follows the visible step in time, byte and raw units', () => {
  for (const unit of ['seconds', 'milliseconds', 'microseconds', 'nanoseconds'] as const) {
    const multiplier = {seconds: 1, milliseconds: 1e3, microseconds: 1e6, nanoseconds: 1e9}[unit]
    const formatter = new TimeFormatter(unit)
    for (const origin of [1.234, 61.234, 1e9]) {
      const start = origin * multiplier
      const step = 0.0001 * multiplier
      const labels = [0, 1, 2].map(i => formatter.format(start + i * step, step))
      expect(new Set(labels).size).toBe(3)
    }
  }
  for (const formatter of [new ByteFormatter(), new RawValueFormatter()]) {
    for (const origin of [0, 1e3, 1e6, 1e9]) {
      const ticks = axisTicks(origin, origin + 0.001, 0.0001)
      const labels = ticks.positions.map(v => formatter.format(v, ticks.interval))
      expect(new Set(labels).size).toBe(labels.length)
    }
  }
  const time = new TimeFormatter('seconds')
  expect(time.format(119.9999, 0.001)).toBe('2:00.000')
  expect(time.format(-61.2345, 0.0001)).toBe('-1:01.2345')
})
