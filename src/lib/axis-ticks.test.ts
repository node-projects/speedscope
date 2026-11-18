import {axisTicks, niceTickInterval} from './axis-ticks'
import {ByteFormatter} from './value-formatters'

test('axis ticks remain distinct and bounded at large origins and sub-ULP intervals', () => {
  const {positions, interval} = axisTicks(1e16, 1e16 + 30, 0.001)
  expect(interval).toBeGreaterThan(0.001)
  expect(positions.length).toBeGreaterThan(1)
  expect(new Set(positions).size).toBe(positions.length)
  expect(
    positions.every((v, i) => v >= 1e16 && v < 1e16 + 30 && (!i || v > positions[i - 1])),
  ).toBe(true)
  expect(axisTicks(0, 1e10, 1).positions.length).toBeLessThanOrEqual(10000)
})

test('ordinary ticks align to the requested step and invalid viewports produce no ticks', () => {
  expect(axisTicks(-0.25, 0.35, 0.1).positions.map(v => Math.round(v * 10))).toEqual([
    -2, -1, 0, 1, 2, 3,
  ])
  for (const args of [
    [0, 1, 0],
    [1, 0, 1],
    [NaN, 1, 1],
    [0, Infinity, 1],
  ])
    expect(axisTicks(args[0], args[1], args[2]).positions).toEqual([])
})

test('memory ticks align to binary units across scales and zoom levels (#35)', () => {
  const formatter = new ByteFormatter()
  for (const scale of [1, 1024, 1024 ** 2, 1024 ** 3, 1024 ** 4]) {
    expect(niceTickInterval(600 * scale, 'bytes')).toBe(512 * scale)
    const ticks = axisTicks(0, 2048 * scale, niceTickInterval(600 * scale, 'bytes'))
    expect(ticks.positions).toEqual([0, 512 * scale, 1024 * scale, 1536 * scale])
    const labels = ticks.positions.map(v => formatter.format(v, ticks.interval))
    expect(new Set(labels).size).toBe(labels.length)
  }
  expect(niceTickInterval(0.7, 'bytes')).toBe(0.5)
  expect(niceTickInterval(600, 'milliseconds')).toBe(500)
  expect(niceTickInterval(230, 'none')).toBe(200)
  expect(niceTickInterval(Infinity, 'bytes')).toBe(0)
})
