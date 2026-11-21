import {createGetCSSColorForFrame} from './getters'
import {Frame, StackListProfileBuilder} from '../lib/profile'
import {frameColorForTheme} from '../lib/frame-color'
import {darkTheme} from '../views/themes/dark-theme'
import {lightTheme} from '../views/themes/light-theme'

test('table indicators honor theme-adapted producer colors and preserve generated fallback', () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 'custom', name: 'custom', color: '#000000'}], 1)
  builder.appendSampleWithWeight([{key: 'default', name: 'default'}], 1)
  const frames: Frame[] = []
  builder.build().forEachFrame(frame => frames.push(frame))
  const frameToColorBucket = new Map<string | number, number>([
    ['custom', 100],
    ['default', 80],
  ])
  for (const theme of [lightTheme, darkTheme]) {
    const color = createGetCSSColorForFrame({theme, frameToColorBucket})
    expect(color(frames[0])).toBe(frameColorForTheme('#000000', theme).toCSS())
    expect(color(frames[1])).toBe(theme.colorForBucket(80 / 255).toCSS())
    expect(frames[0].color).toBe('#000000')
  }
})
