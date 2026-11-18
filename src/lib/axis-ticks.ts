// Index ticks instead of repeatedly adding a small float to a large origin.
// Clamp below representable precision and cap work for degenerate viewports.
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
