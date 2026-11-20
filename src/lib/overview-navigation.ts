import {Flamechart} from './flamechart'
import {Rect, Vec2, clamp} from './math'

export function overviewKeyViewport(
  key: string,
  shift: boolean,
  viewport: Rect,
  chart: Flamechart,
): Rect | null {
  const step = shift ? 0.5 : 0.1
  switch (key) {
    case 'ArrowLeft':
      return viewport.withOrigin(viewport.origin.plus(new Vec2(-viewport.width() * step, 0)))
    case 'ArrowRight':
      return viewport.withOrigin(viewport.origin.plus(new Vec2(viewport.width() * step, 0)))
    case 'ArrowUp':
      return viewport.withOrigin(
        viewport.origin.plus(new Vec2(0, -Math.max(1, viewport.height() * step))),
      )
    case 'ArrowDown':
      return viewport.withOrigin(
        viewport.origin.plus(new Vec2(0, Math.max(1, viewport.height() * step))),
      )
    case 'Home':
      return new Rect(new Vec2(0, -1), new Vec2(chart.getTotalWeight(), viewport.height()))
    case '+':
    case '=':
    case '-':
    case '_': {
      const factor = key === '+' || key === '=' ? (shift ? 0.25 : 0.5) : shift ? 4 : 2
      const width = chart.getClampedViewportWidth(viewport.width() * factor)
      return new Rect(
        viewport.origin.withX(viewport.origin.x + (viewport.width() - width) / 2),
        viewport.size.withX(width),
      )
    }
    default:
      return null
  }
}

// Project only the visible rectangle, without traversing profile/graph nodes.
export function overviewViewportBounds(
  viewport: Rect,
  total: number,
  depth: number,
  size: Vec2,
  axis: number,
  minimumWidth = 2,
): Rect | null {
  if (!(total > 0 && depth > 0 && size.x > 0 && size.y > axis)) return null
  let left = clamp(viewport.left() / total, 0, 1) * size.x
  let right = clamp(viewport.right() / total, 0, 1) * size.x
  const top = axis + clamp(viewport.top() / depth, 0, 1) * (size.y - axis)
  const bottom = axis + clamp(viewport.bottom() / depth, 0, 1) * (size.y - axis)
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top)
    return null
  const width = Math.min(minimumWidth, size.x)
  left = Math.min(left, size.x - width)
  right = Math.max(right, left + width)
  return new Rect(new Vec2(left, top), new Vec2(right - left, bottom - top))
}
