import {Graphics} from './graphics'
import {RectangleBatch, RectangleBatchRenderer} from './rectangle-batch-renderer'
import {FlamechartColorPassRenderer} from './flamechart-color-pass-renderer'
import {TextureRenderer} from './texture-renderer'
import {RowAtlas} from './row-atlas'
import {FlamechartRenderer, FlamechartRowAtlasKey} from './flamechart-renderer'
import {Flamechart} from '../lib/flamechart'
import {StackListProfileBuilder} from '../lib/profile'
import {Rect, Vec2} from '../lib/math'
import {Color} from '../lib/color'
import {lightTheme} from '../views/themes/light-theme'

function context() {
  let blend = ''
  const draws: {blend: string; buffer: {data: Float32Array}}[] = []
  const materials: {vertex: string; fragment: string; samplers: Map<string, unknown>}[] = []
  const gl = {
    viewport: {x: 0, y: 0, width: 100, height: 100},
    createVertexBuffer: () => {
      const buffer = {
        data: new Float32Array(0),
        upload: (bytes: Uint8Array) => {
          buffer.data = new Float32Array(bytes.slice().buffer)
        },
        uploadFloats: (floats: number[]) => {
          buffer.data = new Float32Array(floats)
        },
        free: jest.fn(),
      }
      return buffer
    },
    createMaterial: (_format: unknown, vertex: string, fragment: string) => {
      const samplers = new Map<string, unknown>()
      materials.push({vertex, fragment, samplers})
      return {
        setUniformSampler: (name: string, texture: unknown) => samplers.set(name, texture),
        setUniformMat3: jest.fn(),
        setUniformFloat: jest.fn(),
        setUniformVec2: jest.fn(),
      }
    },
    createTexture: (_format: unknown, width: number, height: number, pixels?: Uint8Array) => {
      const texture = {
        width,
        height,
        pixels,
        free: jest.fn(),
        resize: (w: number, h: number) => {
          texture.width = w
          texture.height = h
        },
      }
      return texture
    },
    createRenderTarget: (texture: Graphics.Texture) => ({
      texture,
      setColor: jest.fn(),
      free: jest.fn(),
    }),
    setViewport: (x: number, y: number, width: number, height: number) => {
      gl.viewport = {x, y, width, height}
    },
    setRenderTarget: jest.fn(),
    addContextResetHandler: jest.fn(),
    clear: jest.fn(),
    setCopyBlendState: () => {
      blend = 'copy'
    },
    setUnpremultipliedBlendState: () => {
      blend = 'opacity'
    },
    draw: (_primitive: unknown, _material: unknown, buffer: {data: Float32Array}) => {
      draws.push({blend, buffer})
    },
  }
  return {gl: gl as unknown as Graphics.Context, draws, materials}
}

test('custom metadata keeps zero alpha through atlas copies and final pass samples a separate opaque palette', () => {
  const {gl, draws, materials} = context()
  const rectangles = new RectangleBatchRenderer(gl)
  const textures = new TextureRenderer(gl)
  const colors = new FlamechartColorPassRenderer(gl, lightTheme)
  const atlas = new RowAtlas<FlamechartRowAtlasKey>(gl, rectangles, textures)
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 0, name: 'custom', color: '#8A2BE2'}], 1)
  builder.appendSampleWithWeight([{key: 1, name: 'generated'}], 1)
  const profile = builder.build()
  const flamechart = new Flamechart({
    getTotalWeight: () => profile.getTotalWeight(),
    forEachCall: profile.forEachCall.bind(profile),
    formatValue: String,
    getColorBucketForFrame: () => 17,
  })
  const renderer = new FlamechartRenderer(gl, atlas, flamechart, rectangles, colors)
  const render = (width: number) =>
    renderer.render({
      configSpaceSrcRect: new Rect(Vec2.zero, new Vec2(2, 1)),
      physicalSpaceDstRect: new Rect(Vec2.zero, new Vec2(width, 100)),
      renderOutlines: true,
    })
  render(100)
  const metadataDraw = draws.find(draw => draw.buffer.data.includes(-1))!
  expect(metadataDraw.blend).toBe('copy')
  expect(metadataDraw.buffer.data[4]).toBe(-1)
  expect(metadataDraw.buffer.data[6 * 5 + 4]).toBeCloseTo(18 / 256)
  // All rectangle/atlas draws copy bytes; only the final presentation blends.
  expect(draws.slice(0, -1).every(draw => draw.blend === 'copy')).toBe(true)
  expect(draws[draws.length - 1].blend).toBe('opacity')
  const colorPass = materials[2]
  const palette = colorPass.samplers.get('frameColorPalette') as {
    pixels: Uint8Array
    free: jest.Mock<unknown>
  }
  expect(palette.pixels.length).toBe(256 * 256 * 4)
  expect(palette.pixels[3]).toBe(255)
  expect(colorPass.samplers.get('colorTexture')).not.toBe(palette)
  render(200)
  expect(colorPass.samplers.get('frameColorPalette')).toBe(palette)
  // Row metadata stays cached while viewport targets resize.
  expect(metadataDraw.buffer.data[4]).toBe(-1)
  const capacity = jest.spyOn(atlas, 'getCapacity')
  capacity.mockImplementation(() => 0)
  const beforeDirect = draws.length
  render(100)
  const direct = draws.slice(beforeDirect)
  expect(direct[0].buffer.data[4]).toBe(-1)
  expect(direct[0].blend).toBe('copy')
  expect(direct[direct.length - 1].blend).toBe('opacity')
  expect(colorPass.samplers.get('frameColorPalette')).toBe(palette)
  jest.restoreAllMocks()
  renderer.free()
  expect(palette.free).toHaveBeenCalledTimes(1)
})

test('packed palette indices cross byte boundaries without widening uploaded vertices', () => {
  const {gl, materials} = context()
  const batch = new RectangleBatch(gl)
  new RectangleBatchRenderer(gl)
  const indices = [0, 254, 255, 65024]
  indices.forEach(index => batch.addRect(Rect.unit, new Color(0.1, 0.2, -1 - index)))
  const buffer = batch.getBuffer(Rect.unit) as unknown as {data: Float32Array}
  expect(buffer.data.length).toBe(indices.length * 6 * 5)
  indices.forEach((index, i) => {
    const packed = buffer.data[i * 6 * 5 + 4]
    const unpacked = -packed - 1
    const blue = Math.round((((unpacked % 255) + 1) / 255) * 255)
    const alpha = Math.round((Math.floor(unpacked / 255) / 255) * 255)
    expect(blue - 1 + alpha * 255).toBe(index)
    expect(alpha).toBeLessThan(255)
  })
  expect(materials[0].vertex).toContain('floor(index / 255.0) / 255.0')
  expect(materials[0].fragment).toContain('gl_FragColor = vColor')
})
