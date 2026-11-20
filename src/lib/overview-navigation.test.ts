import {overviewKeyViewport, overviewViewportBounds} from './overview-navigation'
import {Flamechart} from './flamechart'
import {Rect, Vec2, clamp} from './math'

const chart = {
  getTotalWeight: () => 100,
  getClampedViewportWidth: (v: number) => clamp(v, 1, 100),
} as Flamechart
const current = new Rect(new Vec2(20, 2), new Vec2(20, 10))
test('overview keys pan by viewport size and zoom around its center within width limits', () => {
  expect(overviewKeyViewport('ArrowRight', false, current, chart)!.origin.x).toBe(22)
  expect(overviewKeyViewport('ArrowLeft', true, current, chart)!.origin.x).toBe(10)
  expect(overviewKeyViewport('ArrowDown', true, current, chart)!.origin.y).toBe(7)
  expect(overviewKeyViewport('ArrowUp', false, current, chart)!.origin.y).toBe(1)
  const zoom = overviewKeyViewport('+', false, current, chart)!
  expect(zoom.width()).toBe(10)
  expect(zoom.origin.x + zoom.width() / 2).toBe(30)
  expect(overviewKeyViewport('-', true, current, chart)!.width()).toBe(80)
  const minimum = overviewKeyViewport('+', true, current.withSize(new Vec2(1, 10)), chart)!
  expect(minimum.width()).toBe(1)
  expect(minimum.origin.x).toBe(20)
  expect(overviewKeyViewport('Home', false, current, chart)).toEqual(
    new Rect(new Vec2(0, -1), new Vec2(100, 10)),
  )
  expect(overviewKeyViewport('f', false, current, chart)).toBe(null)
})
test('overview outline clips to the graph area and remains visible at extreme zoom', () => {
  const size = new Vec2(640, 100)
  expect(
    overviewViewportBounds(new Rect(new Vec2(0, -1), new Vec2(100, 30)), 100, 10, size, 20),
  ).toEqual(new Rect(new Vec2(0, 20), new Vec2(640, 80)))
  const narrow = overviewViewportBounds(
    new Rect(new Vec2(99.999999, 0), new Vec2(0.000001, 5)),
    100,
    10,
    size,
    20,
  )!
  expect(narrow.width()).toBeGreaterThanOrEqual(2)
  expect(narrow.right()).toBeLessThanOrEqual(640)
  expect(narrow.top()).toBe(20)
  expect(narrow.bottom()).toBe(60)
  expect(overviewViewportBounds(current, 0, 10, size, 20)).toBe(null)
  expect(overviewViewportBounds(current, 100, 0, size, 20)).toBe(null)
  expect(overviewViewportBounds(current, 100, 10, new Vec2(640, 20), 20)).toBe(null)
  expect(
    overviewViewportBounds(new Rect(new Vec2(NaN, 0), new Vec2(1, 1)), 100, 10, size, 20),
  ).toBe(null)
})
