import {clamp, Vec2, AffineTransform, Rect} from './math'
import * as jsc from 'jsverify'

test('clamp', () => {
  jsc.assertForall(jsc.number, jsc.number, jsc.number, (a, b, c) => {
    const result = clamp(a, b, c)
    if (a < b) return result == b
    if (a > c) return result == c
    return result == a
  })
})

// Change this to jsc.integer to debug failures more easily
let numericType = jsc.number

const arbitraryVec2 = jsc.record({x: jsc.integer, y: numericType}).smap(
  v => new Vec2(v.x, v.y),
  v => v,
)

const positiveVec2 = jsc.suchthat(arbitraryVec2, v => v.x > 0 && v.y > 0)

const arbitraryTransform = jsc
  .record({
    m00: numericType,
    m01: numericType,
    m02: numericType,
    m10: numericType,
    m11: numericType,
    m12: numericType,
  })
  .smap(
    t => new AffineTransform(t.m00, t.m01, t.m02, t.m10, t.m11, t.m12),
    t => t,
  )

const invertibleTransform = jsc.suchthat(arbitraryTransform, t => t.det() != 0)

const simpleTransform = jsc.suchthat(
  jsc.record({scale: arbitraryVec2, translation: arbitraryVec2}).smap(
    t => AffineTransform.withScale(t.scale).withTranslation(t.translation),
    t => ({scale: t.getScale(), translation: t.getTranslation()}),
  ),
  t => t.det() != 0,
)

const arbitraryRect = jsc.record({origin: arbitraryVec2, size: positiveVec2}).smap(
  r => new Rect(r.origin, r.size),
  r => r,
)

function homogeneousMatrix(t: AffineTransform): number[][] {
  return [
    [t.m00, t.m01, t.m02],
    [t.m10, t.m11, t.m12],
    [0, 0, 1],
  ]
}

// Test composition independently of the specialized affine formula and of
// inverse cancellation. Both 3-term dot products incur rounding proportional
// to sum(abs(a_ik * b_kj)), even if their result nearly cancels to zero.
// Four gamma_3 terms conservatively cover the reference and implementation,
// plus rounding in the scale/comparison; MIN_VALUE covers gradual underflow.
// See Higham and Mary, Mixed Precision Algorithms in Numerical Linear Algebra,
// sections 3–4 (standard componentwise matrix-product error bound):
// https://eprints.maths.manchester.ac.uk/2841/1/paper_eprint.pdf
function multiplicationWithinRoundoff(
  product: AffineTransform,
  left: AffineTransform,
  right: AffineTransform,
): boolean {
  const actual = homogeneousMatrix(product)
  const a = homogeneousMatrix(left),
    b = homogeneousMatrix(right)
  const unitRoundoff = Number.EPSILON / 2
  const gamma3 = (3 * unitRoundoff) / (1 - 3 * unitRoundoff)
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 3; column++) {
      let expected = 0,
        scale = 0
      // Reverse the accumulation order used by AffineTransform.times.
      for (let k = 2; k >= 0; k--) {
        const term = a[row][k] * b[k][column]
        expected += term
        scale += Math.abs(term)
      }
      const tolerance = 4 * gamma3 * scale + 4 * Number.MIN_VALUE
      if (
        !Number.isFinite(actual[row][column]) ||
        !Number.isFinite(expected) ||
        !Number.isFinite(tolerance) ||
        Math.abs(actual[row][column] - expected) > tolerance
      )
        return false
    }
  }
  return true
}

describe('Vec2', () => {
  test('constructor', () => {
    jsc.assertForall(jsc.number, jsc.number, (a, b) => {
      const v = new Vec2(a, b)
      return v.x == a && v.y == b
    })
  })

  test('withX', () => {
    jsc.assertForall(arbitraryVec2, jsc.number, (v, n) => {
      return v.withX(n).x === n
    })
  })

  test('withY', () => {
    jsc.assertForall(arbitraryVec2, jsc.number, (v, n) => {
      return v.withY(n).y === n
    })
  })

  test('plus', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      const sum = v1.plus(v2)
      return sum.x === v1.x + v2.x && sum.y === v1.y + v2.y
    })
  })

  test('minus', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      const diff = v1.minus(v2)
      return diff.x === v1.x - v2.x && diff.y === v1.y - v2.y
    })
  })

  test('times', () => {
    jsc.assertForall(arbitraryVec2, jsc.number, (v1, s) => {
      const prod = v1.times(s)
      return prod.x === v1.x * s && prod.y === v1.y * s
    })
  })

  test('timesPointwise', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      const prod = v1.timesPointwise(v2)
      return prod.x === v1.x * v2.x && prod.y === v1.y * v2.y
    })
  })

  test('dividedByPointwise', () => {
    jsc.assertForall(
      arbitraryVec2,
      jsc.suchthat(arbitraryVec2, v => v.x !== 0 && v.y !== 0),
      (v1, v2) => {
        const div = v1.dividedByPointwise(v2)
        return div.x === v1.x / v2.x && div.y === v1.y / v2.y
      },
    )
  })

  test('dot', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return v1.dot(v2) === v1.x * v2.x + v1.y * v2.y
    })
  })

  test('equals', () => {
    jsc.assertForall(jsc.number, jsc.number, (a, b) => {
      return new Vec2(a, b).equals(new Vec2(a, b))
    })

    jsc.assertForall(arbitraryVec2, arbitraryVec2, (a, b) => {
      return a.equals(b) === (a.x === b.x && a.y === b.y)
    })
  })

  test('length2', () => {
    jsc.assertForall(arbitraryVec2, v => {
      return v.length2() === v.x * v.x + v.y * v.y
    })
  })

  test('length', () => {
    jsc.assertForall(arbitraryVec2, v => {
      return v.length() === Math.sqrt(v.x * v.x + v.y * v.y)
    })
  })

  test('abs', () => {
    jsc.assertForall(arbitraryVec2, v => {
      const q = v.abs()
      return q.x === Math.abs(v.x) && q.y === Math.abs(v.y)
    })
  })

  test('min', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      const min = Vec2.min(v1, v2)
      return min.x === Math.min(v1.x, v2.x) && min.y === Math.min(v1.y, v2.y)
    })
  })

  test('max', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      const max = Vec2.max(v1, v2)
      return max.x === Math.max(v1.x, v2.x) && max.y === Math.max(v1.y, v2.y)
    })
  })

  test('flatten', () => {
    jsc.assertForall(arbitraryVec2, v1 => {
      const flat = v1.flatten()
      return flat[0] == v1.x && flat[1] == v1.y
    })
  })
})

describe('Rect', () => {
  test('isEmpty', () => {
    jsc.assertForall(arbitraryVec2, jsc.number, (v, n) => {
      return new Rect(v, new Vec2(0, n)).isEmpty()
    })
    jsc.assertForall(arbitraryVec2, jsc.number, (v, n) => {
      return new Rect(v, new Vec2(n, 0)).isEmpty()
    })
    jsc.assertForall(arbitraryVec2, v => {
      return !new Rect(v, Vec2.unit).isEmpty()
    })
  })

  test('width', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).width() == v2.x
    })
  })
  test('height', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).height() == v2.y
    })
  })
  test('left', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).left() == v1.x
    })
  })
  test('top', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).top() == v1.y
    })
  })
  test('right', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).right() == v1.x + v2.x
    })
  })
  test('bottom', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).bottom() == v1.y + v2.y
    })
  })
  test('topLeft', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).topLeft().equals(v1)
    })
  })
  test('topRight', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).topRight().equals(v1.plus(v2.withY(0)))
    })
  })
  test('bottomLeft', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).bottomLeft().equals(v1.plus(v2.withX(0)))
    })
  })
  test('bottomRight', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return new Rect(v1, v2).bottomRight().equals(v1.plus(v2))
    })
  })

  test('withOrigin', () => {
    jsc.assertForall(arbitraryRect, arbitraryVec2, (r, v) => {
      return r.withOrigin(v).origin.equals(v)
    })
  })
  test('withSize', () => {
    jsc.assertForall(arbitraryRect, arbitraryVec2, (r, v) => {
      return r.withSize(v).size.equals(v)
    })
  })

  test('closestPointTo', () => {
    jsc.assertForall(arbitraryRect, arbitraryVec2, (r, v) => {
      const p = r.closestPointTo(v)
      return p.x >= r.left() && p.x <= r.right() && p.y >= r.top() && p.y <= r.bottom()
    })
  })

  test('hasIntersectionWith', () => {
    jsc.assertForall(arbitraryRect, arbitraryRect, (r1, r2) => {
      return r1.hasIntersectionWith(r2) === !r1.intersectWith(r2).isEmpty()
    })
  })

  test('intersectWith', () => {
    jsc.assertForall(arbitraryRect, arbitraryRect, (r1, r2) => {
      const inter = r1.intersectWith(r2)
      return inter.isEmpty() || (r1.hasIntersectionWith(inter) && r2.hasIntersectionWith(inter))
    })
  })
})

describe('AffineTransform', () => {
  test('inverted', () => {
    expect(new AffineTransform(0, 0, 0, 0, 0, 0).inverted()).toBe(null)

    jsc.assertForall(invertibleTransform, t => {
      return t.inverted()!.inverted()!.approxEquals(t)
    })
  })

  test('translation', () => {
    jsc.assertForall(arbitraryTransform, arbitraryVec2, (t, v1) => {
      return t.withTranslation(v1).getTranslation().equals(v1)
    })

    jsc.assertForall(arbitraryTransform, arbitraryVec2, (t, v1) => {
      const initialTranslation = t.getTranslation()
      return t.translatedBy(v1).getTranslation().approxEquals(initialTranslation.plus(v1))
    })
  })

  test('scale', () => {
    jsc.assertForall(arbitraryTransform, arbitraryVec2, (t, v1) => {
      return t.withScale(v1).getScale().equals(v1)
    })
  })

  test('transformVector', () => {
    // Vector transformation are translation-invariant
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return AffineTransform.withTranslation(v1).transformVector(v2).approxEquals(v2)
    })

    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return AffineTransform.withScale(v1).transformVector(v2).approxEquals(v2.timesPointwise(v1))
    })
  })

  test('inverseTransformVector', () => {
    jsc.assertForall(invertibleTransform, arbitraryVec2, (t, v) => {
      return t.inverseTransformVector(t.transformVector(v))!.approxEquals(v)
    })
  })

  test('transformPosition', () => {
    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return AffineTransform.withTranslation(v1).transformPosition(v2).approxEquals(v2.plus(v1))
    })

    jsc.assertForall(arbitraryVec2, arbitraryVec2, (v1, v2) => {
      return AffineTransform.withScale(v1).transformPosition(v2).approxEquals(v2.timesPointwise(v1))
    })
  })

  test('inverseTransformPosition', () => {
    jsc.assertForall(invertibleTransform, arbitraryVec2, (t, v) => {
      return t.inverseTransformPosition(t.transformPosition(v))!.approxEquals(v)
    })
  })

  test('transformRect', () => {
    jsc.assertForall(arbitraryVec2, arbitraryRect, (v, r) => {
      return AffineTransform.withTranslation(v)
        .transformRect(r)
        .equals(r.withOrigin(r.origin.plus(v)))
    })

    jsc.assertForall(arbitraryVec2, arbitraryRect, (v, r) => {
      const t = AffineTransform.withScale(v)
      const rt = t.transformRect(r)
      return Math.abs(rt.area() - r.area() * Math.abs(t.det())) < 1e-6
    })
  })

  test('inverseTransformRect', () => {
    jsc.assertForall(simpleTransform, arbitraryRect, (t, r) => {
      return t.inverseTransformRect(t.transformRect(r))!.approxEquals(r)
    })
  })

  test('times', () => {
    // Singular transforms are valid multiplication inputs too. Do not discard
    // poorly conditioned matrices or narrow their generator to hide #138.
    jsc.assertForall(arbitraryTransform, arbitraryTransform, (t1, t2) => {
      return multiplicationWithinRoundoff(t1.times(t2), t1, t2)
    })
  })

  test('times recorded #138 counterexample separates multiplication from inverse cancellation', () => {
    const t1 = new AffineTransform(
      0,
      -5.367341258943892e-7,
      0,
      -5.637762076626807e-7,
      22.105444583576173,
      0,
    )
    const t2 = new AffineTransform(
      -19.956948631443083,
      41.27141907811165,
      32.4375735828653,
      -19.53049001749605,
      40.38256627973169,
      3.136250004172325,
    )
    const inverse = t2.inverted()!
    const product = t1.times(t2)
    const roundTrip = product.times(inverse)
    // The old absolute 1e-9 oracle rejects this legitimate composition. Both
    // multiplication stages still satisfy their scale-aware rounding bound.
    expect(roundTrip.approxEquals(t1)).toBe(false)
    expect(multiplicationWithinRoundoff(product, t1, t2)).toBe(true)
    expect(multiplicationWithinRoundoff(roundTrip, product, inverse)).toBe(true)
  })

  test('times reference rejects order and coefficient mistakes', () => {
    const left = new AffineTransform(2, 0, 5, 0, 3, 7)
    const right = new AffineTransform(1, 4, 11, 2, 1, 13)
    const product = left.times(right)
    expect(product.equals(new AffineTransform(2, 8, 27, 6, 3, 46))).toBe(true)
    expect(multiplicationWithinRoundoff(right.times(left), left, right)).toBe(false)
    const wrong = product.withTranslation(product.getTranslation().plus(new Vec2(0, 1e-6)))
    expect(multiplicationWithinRoundoff(wrong, left, right)).toBe(false)
  })

  test('times reference uses operand scale rather than a permissive absolute epsilon', () => {
    for (const scale of [1e-150, 1e-75, 1, 1e75, 1e150]) {
      const left = new AffineTransform(
        scale,
        -2 * scale,
        3 * scale,
        4 * scale,
        5 * scale,
        -6 * scale,
      )
      const right = new AffineTransform(
        2 * scale,
        3 * scale,
        4 * scale,
        -scale,
        5 * scale,
        6 * scale,
      )
      const product = left.times(right)
      expect(multiplicationWithinRoundoff(product, left, right)).toBe(true)
      const wrong = new AffineTransform(
        product.m00 * 1.01,
        product.m01,
        product.m02,
        product.m10,
        product.m11,
        product.m12,
      )
      expect(multiplicationWithinRoundoff(wrong, left, right)).toBe(false)
    }
  })
})
