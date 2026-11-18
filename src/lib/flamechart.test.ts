import {Flamechart} from './flamechart'
import {StackListProfileBuilder} from './profile'
import {Rect, Vec2} from './math'

test('vertical panning cannot hide the root when all rows fit (#348)', () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [
      {key: 'a', name: 'a'},
      {key: 'b', name: 'b'},
    ],
    10,
  )
  const profile = builder.build()
  const chart = new Flamechart({
    getTotalWeight: () => profile.getTotalWeight(),
    formatValue: value => profile.formatValue(value),
    forEachCall: profile.forEachCall.bind(profile),
    getColorBucketForFrame: () => 0,
  })
  const viewport = (height: number) =>
    chart.getClampedConfigSpaceViewportRect({
      configSpaceViewportRect: new Rect(new Vec2(0, -1), new Vec2(10, height)),
    })
  expect(viewport(10).origin.y).toBe(0)
  expect(viewport(1).origin.y).toBe(-1)
})
