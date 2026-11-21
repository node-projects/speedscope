import {Color} from './color'
import {colorContrast, frameColorForTheme} from './frame-color'
import {darkTheme} from '../views/themes/dark-theme'
import {lightTheme} from '../views/themes/light-theme'

for (const [name, theme] of [
  ['dark', darkTheme],
  ['light', lightTheme],
] as const) {
  test(`${name} adapts producer backgrounds for normal label contrast`, () => {
    for (const hex of ['#000000', '#FFFFFF', '#8A2BE2', '#FF0000', '#00FF00', '#123456']) {
      const displayed = frameColorForTheme(hex, theme)
      // Include 8-bit texture quantization, not only double-precision colors.
      const quantized = new Color(
        ...([displayed.r, displayed.g, displayed.b].map(v => Math.round(v * 255) / 255) as [
          number,
          number,
          number,
        ]),
      )
      expect(
        colorContrast(quantized, Color.fromCSSHex(theme.fgPrimaryColor)),
      ).toBeGreaterThanOrEqual(4.5)
      if (colorContrast(Color.fromCSSHex(hex), Color.fromCSSHex(theme.fgPrimaryColor)) >= 4.55) {
        expect(displayed).toEqual(Color.fromCSSHex(hex))
      }
    }
  })
}
