import {Rect, Vec2, AffineTransform} from '../lib/math'
import {Color} from '../lib/color'
import {Graphics} from './graphics'
import {setUniformAffineTransform} from './utils'

export const MAX_BATCH_SIZE = 10000

// Shared scratch only: uploaded vertex buffers own their bytes. The renderer's
// batch limit bounds this to 1,200,000 bytes rather than retaining staging data per batch
// or a new buffer for every viewport/atlas tile.
let uploadBytes = new Uint8Array(0)

const vertexFormat = new Graphics.VertexFormat()
vertexFormat.add('unitSpacePos', Graphics.AttributeType.FLOAT, 2)
vertexFormat.add('color', Graphics.AttributeType.FLOAT, 3)

const vert = `
  uniform mat3 unitSpaceToNDC;

  attribute vec2 unitSpacePos;
  attribute vec3 color;
  varying vec3 vColor;

  void main() {
    vColor = color;
    vec2 position = (unitSpaceToNDC * vec3(unitSpacePos, 1)).xy;
    gl_Position = vec4(position, 1, 1);
  }
`

const frag = `
  precision mediump float;
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor.rgb, 1);
  }
`

export class RectangleBatch {
  private rects: Rect[] = []
  private colors: Color[] = []
  constructor(private gl: Graphics.Context) {}

  getRectCount() {
    return this.rects.length
  }

  private buffer: Graphics.VertexBuffer | null = null
  private bufferSource: Rect | null = null
  getBuffer(source: Rect): Graphics.VertexBuffer {
    if (this.buffer && this.bufferSource?.equals(source)) {
      return this.buffer
    }

    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 1],
    ]

    const byteCount = vertexFormat.stride * corners.length * this.rects.length
    if (uploadBytes.length < byteCount) uploadBytes = new Uint8Array(byteCount)
    const bytes = uploadBytes.subarray(0, byteCount)
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, byteCount / 4)
    let idx = 0

    for (let i = 0; i < this.rects.length; i++) {
      const rect = this.rects[i]
      const color = this.colors[i]

      // Keep global times in doubles until subtraction. Even at 6e9 us, a
      // 100-us call is distinguishable here but can have zero width if its
      // absolute endpoints are first rounded to float32. Clip before upload so
      // a very wide batch cannot introduce huge offscreen shader coordinates.
      const left = Math.max(rect.left(), source.left())
      const right = Math.min(rect.right(), source.right())
      const top = Math.max(rect.top(), source.top())
      const bottom = Math.min(rect.bottom(), source.bottom())
      const visible = right > left && bottom > top
      const x0 = visible ? (left - source.left()) / source.width() : 0
      const x1 = visible ? (right - source.left()) / source.width() : 0
      const y0 = visible ? (top - source.top()) / source.height() : 0
      const y1 = visible ? (bottom - source.top()) / source.height() : 0

      // TODO(jlfwong): In the conversion from regl to graphics.ts, I lost the
      // ability to do instanced drawing. This is a pretty significant hit to
      // the performance here since I need 6x the memory to allocate these
      // things. Adding instanced drawing to graphics.ts is non-trivial, so I'm
      // just going to try this for now.
      for (let corner of corners) {
        floats[idx++] = corner[0] ? x1 : x0
        floats[idx++] = corner[1] ? y1 : y0

        floats[idx++] = color.r
        floats[idx++] = color.g
        floats[idx++] = color.b
      }
    }

    if (idx !== floats.length) {
      throw new Error("Buffer expected to be full but wasn't")
    }

    if (!this.buffer) this.buffer = this.gl.createVertexBuffer(bytes.length)
    this.buffer.upload(bytes)
    this.bufferSource = source
    return this.buffer
  }

  addRect(rect: Rect, color: Color) {
    if (this.rects.length >= MAX_BATCH_SIZE) throw new Error('Rectangle batch exceeds its limit')
    this.rects.push(rect)
    this.colors.push(color)

    if (this.buffer) {
      this.buffer.free()
      this.buffer = null
      this.bufferSource = null
    }
  }

  free() {
    if (this.buffer) {
      this.buffer.free()
      this.buffer = null
      this.bufferSource = null
    }
  }
}

export interface RectangleBatchRendererProps {
  batch: RectangleBatch
  configSpaceSrcRect: Rect
  physicalSpaceDstRect: Rect
}

export class RectangleBatchRenderer {
  material: Graphics.Material
  constructor(private gl: Graphics.Context) {
    this.material = gl.createMaterial(vertexFormat, vert, frag)
  }

  render(props: RectangleBatchRendererProps) {
    if (props.configSpaceSrcRect.isEmpty() || props.physicalSpaceDstRect.isEmpty()) return
    setUniformAffineTransform(
      this.material,
      'unitSpaceToNDC',
      (() => {
        const configToPhysical = AffineTransform.betweenRects(Rect.unit, props.physicalSpaceDstRect)

        const viewportSize = new Vec2(this.gl.viewport.width, this.gl.viewport.height)

        const physicalToNDC = AffineTransform.withTranslation(new Vec2(-1, 1)).times(
          AffineTransform.withScale(new Vec2(2, -2).dividedByPointwise(viewportSize)),
        )

        return physicalToNDC.times(configToPhysical)
      })(),
    )

    this.gl.setUnpremultipliedBlendState()
    this.gl.draw(
      Graphics.Primitive.TRIANGLES,
      this.material,
      props.batch.getBuffer(props.configSpaceSrcRect),
    )
  }
}
