import {Color} from './color'

describe('Color', () => {
  test('fromLumaChromaHue', () => {
    expect(Color.fromLumaChromaHue(0, 0, 0).toCSS()).toEqual('rgba(0, 0, 0, 1.00)')
    expect(Color.fromLumaChromaHue(1, 0, 0).toCSS()).toEqual('rgba(255, 255, 255, 1.00)')

    expect(Color.fromLumaChromaHue(0.5, 0, 30).toCSS()).toEqual('rgba(128, 128, 128, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 0, 60).toCSS()).toEqual('rgba(128, 128, 128, 1.00)')

    expect(Color.fromLumaChromaHue(0.5, 0.5, 0).toCSS()).toEqual('rgba(217, 89, 89, 1.00)')

    expect(Color.fromLumaChromaHue(0.5, 1.0, 0).toCSS()).toEqual('rgba(255, 51, 51, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 60).toCSS()).toEqual('rgba(156, 156, 0, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 120).toCSS()).toEqual('rgba(0, 232, 0, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 180).toCSS()).toEqual('rgba(0, 204, 204, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 240).toCSS()).toEqual('rgba(99, 99, 255, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 300).toCSS()).toEqual('rgba(255, 23, 255, 1.00)')
    expect(Color.fromLumaChromaHue(0.5, 1.0, 360).toCSS()).toEqual('rgba(255, 51, 51, 1.00)')
  })

  test('toCSS', () => {
    expect(new Color().toCSS()).toEqual('rgba(0, 0, 0, 1.00)')
    expect(new Color(1, 0, 0, 1).toCSS()).toEqual('rgba(255, 0, 0, 1.00)')
    expect(new Color(0, 1, 0, 1).toCSS()).toEqual('rgba(0, 255, 0, 1.00)')
    expect(new Color(0, 0, 1, 1).toCSS()).toEqual('rgba(0, 0, 255, 1.00)')
    expect(new Color(0, 0, 1, 0.599).toCSS()).toEqual('rgba(0, 0, 255, 0.60)')
  })
})

test('CSS hex parsing rejects invalid and partially parsed channels instead of creating NaN colors', () => {
  for (const input of [
    '#gggggg',
    '#12345g',
    '#1g2233',
    '#11223g',
    '#-12233',
    '#112233\n',
    '112233',
    '#fff',
    '#11223344',
    '#112233 ',
  ])
    expect(() => Color.fromCSSHex(input)).toThrow('Invalid color input')
})

test('CSS hex colors preserve exact channel bytes and accept either letter case', () => {
  for (const input of ['#000000', '#ffffff', '#8A2BE2', '#8a2be2', '#012345']) {
    const color = Color.fromCSSHex(input)
    expect(color.a).toBe(1)
    expect([color.r, color.g, color.b].map(value => Math.round(value * 255))).toEqual(
      [1, 3, 5].map(at => parseInt(input.slice(at, at + 2), 16)),
    )
    expect(color.toCSS()).not.toContain('NaN')
  }
})
