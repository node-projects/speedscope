// Index ticks instead of repeatedly adding a small float to a large origin.
// Clamp below representable precision and cap work for degenerate viewports.
import {FileFormat} from './file-format-spec'

export function niceTickInterval(target: number, unit: FileFormat.ValueUnit = 'none'): number {
  if (!Number.isFinite(target) || target <= 0) return 0
  if (unit === 'bytes') return Math.pow(2, Math.floor(Math.log2(target)))
  const base = Math.max(Number.MIN_VALUE, Math.pow(10, Math.floor(Math.log10(target))))
  const ratio = target / base
  return base * (ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1)
}

export function axisTicks(left: number, right: number, interval: number) {
  const positions: number[] = []
  if (![left, right, interval].every(Number.isFinite) || right <= left || interval <= 0)
    return {interval, positions}
  interval = Math.max(interval, Math.max(Math.abs(left), Math.abs(right)) * Number.EPSILON)
  const first = Math.ceil(left / interval)
  const count = Math.min(10000, Math.ceil((right - left) / interval) + 2)
  for (let i = 0; i < count; i++) {
    const value = (first + i) * interval
    if (value >= right) break
    if (value >= left && (!positions.length || value > positions[positions.length - 1]))
      positions.push(value)
  }
  return {interval, positions}
}
