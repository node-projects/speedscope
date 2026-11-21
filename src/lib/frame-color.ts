import {Color} from './color'

function luminance(color: Color): number {
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

export function colorContrast(a: Color, b: Color): number {
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// Keep producer RGB in the data. Only the displayed background is moved toward
// the active theme background, as little as necessary for normal labels. Search
// intentionally dims unmatched labels using the existing secondary foreground.
export function frameColorForTheme(
  hex: string,
  theme: {bgPrimaryColor: string; fgPrimaryColor: string},
): Color {
  const color = Color.fromCSSHex(hex)
  const background = Color.fromCSSHex(theme.bgPrimaryColor)
  const label = Color.fromCSSHex(theme.fgPrimaryColor)
  const readable = (candidate: Color) => colorContrast(candidate, label) >= 4.55
  if (readable(color)) return color
  const mix = (t: number) =>
    new Color(
      color.r + t * (background.r - color.r),
      color.g + t * (background.g - color.g),
      color.b + t * (background.b - color.b),
    )
  let low = 0,
    high = 1
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2
    if (readable(mix(middle))) high = middle
    else low = middle
  }
  return mix(high)
}
