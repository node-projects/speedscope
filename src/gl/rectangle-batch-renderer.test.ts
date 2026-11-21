import fs from 'fs'
import {RectangleBatch, RectangleBatchRenderer, MAX_BATCH_SIZE} from './rectangle-batch-renderer'
import {Graphics} from './graphics'
import {Color} from '../lib/color'
import {Rect, Vec2} from '../lib/math'
import {importSpeedscopeProfiles} from '../lib/file-format'

const rect = (x: number, y: number, w: number, h: number) =>
  new Rect(new Vec2(x, y), new Vec2(w, h))

function context() {
  const buffers: {data: Float32Array; upload: jest.Mock<unknown>; free: jest.Mock<unknown>}[] = []
  const uniforms = new Map<string, number[]>()
  const material = {
    setUniformMat3: jest.fn((name: string, ...values: number[]) => uniforms.set(name, values)),
  }
  const gl = {
    viewport: {x: 0, y: 0, width: 1200, height: 100},
    createVertexBuffer: jest.fn((_byteCount: number) => {
      const buffer = {
        data: new Float32Array(0),
        upload: jest.fn((bytes: Uint8Array) => {
          // Match Graphics.VertexBuffer.upload: uploaded staging bytes are copied.
          buffer.data = new Float32Array(bytes.slice().buffer)
        }),
        free: jest.fn(),
      }
      buffers.push(buffer)
      return buffer
    }),
    createMaterial: jest.fn((_format: unknown, _vertex: string, _fragment: string) => material),
    setUnpremultipliedBlendState: jest.fn(),
    draw: jest.fn(),
  }
  return {gl: gl as unknown as Graphics.Context, raw: gl, buffers, uniforms}
}

function shaderX(data: Float32Array, vertex: number, matrix: number[]) {
  // Use the real uploaded coordinates and uniform transform, with float32
  // arithmetic at the vertex-shader boundary.
  const f = Math.fround
  return f(
    f(f(f(matrix[0]) * data[vertex * 5]) + f(f(matrix[1]) * data[vertex * 5 + 1])) + f(matrix[2]),
  )
}

test('late narrow calls stay distinct when an early call shares the same wide batch', () => {
  const c = context(),
    batch = new RectangleBatch(c.gl),
    renderer = new RectangleBatchRenderer(c.gl)
  const start = 5999999000
  expect(Math.fround(start)).toBe(Math.fround(start + 100))
  batch.addRect(rect(0, 7, 100, 1), new Color(1, 0, 0))
  batch.addRect(rect(start, 7, 100, 1), new Color(0, 1, 0))
  batch.addRect(rect(start + 100, 7, 100, 1), new Color(0, 0, 1))
  renderer.render({
    batch,
    configSpaceSrcRect: rect(start, 7, 400, 1),
    physicalSpaceDstRect: rect(100, 40, 1000, 40),
  })
  const data = c.buffers[0].data,
    matrix = c.uniforms.get('unitSpaceToNDC')!
  expect(c.raw.createMaterial.mock.calls[0][1]).toContain('unitSpaceToNDC * vec3(unitSpacePos, 1)')
  expect(data[6 * 5]).toBe(0)
  expect(data[7 * 5]).toBe(0.25)
  expect(data[12 * 5]).toBe(0.25)
  expect(data[13 * 5]).toBe(0.5)
  expect(shaderX(data, 6, matrix)).toBeCloseTo(-5 / 6, 6)
  expect(shaderX(data, 7, matrix)).toBeCloseTo(-5 / 12, 6)
  expect(shaderX(data, 12, matrix)).toBe(shaderX(data, 7, matrix))
  expect(shaderX(data, 13, matrix)).toBeCloseTo(0, 6)
  expect(Array.from(data.slice(6 * 5 + 2, 6 * 5 + 5))).toEqual([0, 1, 0])
  expect(Array.from(data.slice(12 * 5 + 2, 12 * 5 + 5))).toEqual([0, 0, 1])
  expect(Array.from(data.slice(0, 30)).filter((_, i) => i % 5 < 2)).toEqual(Array(12).fill(0))
})

test('source clipping handles ordinary, negative and spanning coordinates in both axes', () => {
  const c = context(),
    batch = new RectangleBatch(c.gl)
  batch.addRect(rect(-200, -10, 400, 20), new Color(1, 0, 0))
  batch.addRect(rect(-5, -3, 10, 2), new Color(0, 1, 0))
  batch.getBuffer(rect(-10, -4, 40, 4))
  const data = c.buffers[0].data
  expect(Array.from(data.slice(0, 2))).toEqual([0, 0])
  expect(Array.from(data.slice(5 * 5, 5 * 5 + 2))).toEqual([1, 1])
  expect(Array.from(data.slice(6 * 5, 6 * 5 + 2))).toEqual([0.125, 0.25])
  expect(Array.from(data.slice(11 * 5, 11 * 5 + 2))).toEqual([0.375, 0.75])
  for (let i = 0; i < data.length; i++)
    if (i % 5 < 2) {
      expect(data[i]).toBeGreaterThanOrEqual(0)
      expect(data[i]).toBeLessThanOrEqual(1)
    }
})

test('tile reuse caches one buffer, while changed origins or extents repack it in place', () => {
  const c = context(),
    batch = new RectangleBatch(c.gl),
    renderer = new RectangleBatchRenderer(c.gl)
  batch.addRect(rect(1000, 4, 20, 1), new Color(0, 1, 0))
  const source = rect(1000, 4, 40, 1)
  const render = (src: Rect, dst = Rect.unit) =>
    renderer.render({batch, configSpaceSrcRect: src, physicalSpaceDstRect: dst})
  render(source)
  const buffer = c.buffers[0]
  render(rect(1000, 4, 40, 1), rect(100, 0, 300, 50))
  expect(buffer.upload).toHaveBeenCalledTimes(1)
  render(rect(1010, 4, 40, 1))
  expect(buffer.data[5]).toBe(0.25)
  render(rect(1000, 4, 80, 1))
  expect(buffer.data[5]).toBe(0.25)
  render(source)
  expect(buffer.data[5]).toBe(0.5)
  expect(buffer.upload).toHaveBeenCalledTimes(4)
  expect(c.raw.createVertexBuffer).toHaveBeenCalledTimes(1)
  expect(buffer.free).not.toHaveBeenCalled()
  batch.free()
  expect(buffer.free).toHaveBeenCalledTimes(1)
  render(source)
  expect(c.raw.createVertexBuffer).toHaveBeenCalledTimes(2)
})

test('batch growth invalidates geometry, shared scratch preserves other uploads, and capacity is bounded', () => {
  const c = context(),
    first = new RectangleBatch(c.gl),
    second = new RectangleBatch(c.gl)
  first.addRect(Rect.unit, new Color(1, 0, 0))
  first.getBuffer(Rect.unit)
  const original = c.buffers[0],
    values = Array.from(original.data)
  second.addRect(Rect.unit, new Color(0, 0, 1))
  second.getBuffer(Rect.unit)
  expect(Array.from(original.data)).toEqual(values)
  first.addRect(rect(1, 0, 1, 1), new Color(0, 1, 0))
  expect(original.free).toHaveBeenCalledTimes(1)
  expect(first.getBuffer(rect(0, 0, 2, 1))).not.toBe(original)
  for (let i = 1; i < MAX_BATCH_SIZE; i++) second.addRect(Rect.unit, new Color(1, 0, 0))
  expect(() => second.addRect(Rect.unit, new Color(1, 0, 0))).toThrow('batch exceeds')
  expect(second.getRectCount()).toBe(MAX_BATCH_SIZE)
})

test('the synthetic 6000-second recording retains exact late durations before rendering', () => {
  const group = importSpeedscopeProfiles(
    JSON.parse(
      fs.readFileSync('sample/profiles/speedscope/long-late-calls.speedscope.json', 'utf8'),
    ),
  )
  const late: [string, number][] = []
  group.profiles[0].forEachCall(
    node => {
      if (node.frame.name.startsWith('late_child'))
        late.push([node.frame.name, node.getTotalWeight()])
    },
    () => {},
  )
  expect(group.profiles[0].getTotalWeight()).toBe(6000000000)
  expect(late).toEqual([
    ['late_child_a', 100],
    ['late_child_b', 100],
  ])
})
