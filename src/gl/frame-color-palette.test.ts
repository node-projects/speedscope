import {FrameColorPalette, MAX_CUSTOM_FRAME_COLORS} from './frame-color-palette'
import {lightTheme} from '../views/themes/light-theme'
import {frameColorForTheme} from '../lib/frame-color'

test('palette allocates only for custom colors, canonicalizes identity and keeps fixed byte bounds', () => {
  const palette = new FrameColorPalette(lightTheme)
  expect(palette.getPixels()).toBeNull()
  expect(palette.getIndex('#8A2BE2')).toBe(0)
  expect(palette.getIndex('#8a2be2')).toBe(0)
  expect(palette.getIndex('#00FF00')).toBe(1)
  const pixels = palette.getPixels()!
  expect(pixels.length).toBe(256 * 256 * 4)
  const color = frameColorForTheme('#8A2BE2', lightTheme)
  expect(Array.from(pixels.subarray(0, 4))).toEqual([
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    255,
  ])
})

test('palette row boundaries and capacity never alias an earlier producer color', () => {
  const palette = new FrameColorPalette(lightTheme)
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    for (let i = 0; i < MAX_CUSTOM_FRAME_COLORS; i++) {
      expect(palette.getIndex(`#${i.toString(16).padStart(6, '0')}`)).toBe(i)
    }
    expect(palette.getIndex('#FFFFFF')).toBeNull()
    expect(palette.getIndex('#FFFFFE')).toBeNull()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(palette.getIndex('#000000')).toBe(0)
    for (const index of [0, 254, 255, MAX_CUSTOM_FRAME_COLORS - 1]) {
      const offset = (Math.floor(index / 255) * 256 + (index % 255)) * 4
      expect(palette.getPixels()![offset + 3]).toBe(255)
    }
    // Unused final column and row cannot accidentally contain a valid color.
    expect(palette.getPixels()![255 * 4 + 3]).toBe(0)
    expect(palette.getPixels()![255 * 256 * 4 + 3]).toBe(0)
  } finally {
    jest.restoreAllMocks()
  }
})
