import {frameColorForTheme} from '../lib/frame-color'
import {Theme} from '../views/themes/theme'

// Alpha 255 is reserved for the existing generated theme palette. Custom RGB
// uses rows 0..254 and columns 0..254; metadata blue zero stays background.
export const MAX_CUSTOM_FRAME_COLORS = 255 * 255

export class FrameColorPalette {
  private indexes = new Map<string, number>()
  private warned = false
  private pixels: Uint8Array | null = null
  constructor(private theme: Theme) {}

  getIndex(hex: string): number | null {
    const key = hex.toLowerCase()
    const existing = this.indexes.get(key)
    if (existing !== undefined) return existing
    if (this.indexes.size >= MAX_CUSTOM_FRAME_COLORS) {
      if (!this.warned) {
        console.warn(
          `More than ${MAX_CUSTOM_FRAME_COLORS} custom frame colors; additional colors use the generated theme palette`,
        )
        this.warned = true
      }
      return null
    }
    const index = this.indexes.size
    this.indexes.set(key, index)
    if (!this.pixels) this.pixels = new Uint8Array(256 * 256 * 4)
    const color = frameColorForTheme(hex, this.theme)
    const offset = (Math.floor(index / 255) * 256 + (index % 255)) * 4
    this.pixels[offset] = Math.round(color.r * 255)
    this.pixels[offset + 1] = Math.round(color.g * 255)
    this.pixels[offset + 2] = Math.round(color.b * 255)
    this.pixels[offset + 3] = 255
    return index
  }

  getPixels(): Uint8Array | null {
    return this.pixels
  }
}
