import {axisTicks} from './axis-ticks'

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
