import * as THREE from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { buildFaceGeometry } from './faceMesh'
import { COPY_FRAGMENT, MESH_VERTEX, QUAD_VERTEX } from './shaders/matteBlend'
import { DETAIL_FRAGMENT } from './shaders/detail'
import { MAKEUP_FRAGMENT } from './shaders/makeupBlend'
import { FINISH_PARAMS } from './shaders/finishes'
import { regionalMeans } from './photoMasks'
import type { ApplicableRegion, FinishType } from '../../types/models'

// Colour conversion is explicit in the shader. Disable implicit conversion to avoid applying it twice.
THREE.ColorManagement.enabled = false

export interface CompositorLayer {
  /** Coverage in canonical UV space: a region fill, or the user's brush strokes. */
  coverage: HTMLCanvasElement
  photoSpace?: boolean
  region?: ApplicableRegion
  opacity?: number
  /** Preserve the captured illumination; 3D gloss is rendered separately. */
  surfaceMode?: boolean
  /** sRGB components in 0..1. */
  color: [number, number, number]
  intensity: number
  finish: FinishType
}

/**
 * Draws the photo, then paints each makeup layer onto it through the face mesh.
 *
 * Two passes per layer: the backdrop is copied forward first, because the mesh
 * covers only the face and would otherwise leave the rest of the photo blank.
 * The blend shader then reads that backdrop — real pigment maths needs the
 * pixels underneath, which fixed-function GPU blending cannot provide.
 */
export class MakeupCompositor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly quad: THREE.Mesh
  private readonly copy: THREE.ShaderMaterial
  private readonly blend: THREE.ShaderMaterial
  private readonly detail: THREE.ShaderMaterial

  private faceMesh: THREE.Mesh | null = null
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null
  private detailTarget: THREE.WebGLRenderTarget | null = null
  private means = new Map<ApplicableRegion, number>()
  private baseTexture: THREE.Texture | null = null
  private coverageTextures = new Map<HTMLCanvasElement, THREE.CanvasTexture>()
  private size = { width: 0, height: 0 }

  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      // Keeps the rendered frame readable after compositing, which is what lets
      // a finished look be exported as an image.
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(1)
    // outputColorSpace is left at its default: with ColorManagement disabled
    // above, three performs no conversion either way, and NoColorSpace is not a
    // valid output space.

    const shared = { depthTest: false, depthWrite: false }
    this.copy = new THREE.ShaderMaterial({
      ...shared,
      vertexShader: QUAD_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      uniforms: { uSource: { value: null }, uFlipY: { value: 0 } },
    })
    this.blend = new THREE.ShaderMaterial({
      ...shared,
      vertexShader: MESH_VERTEX,
      fragmentShader: MAKEUP_FRAGMENT,
      uniforms: {
        uBackdrop: { value: null },
        uDetail: { value: null },
        uCoverage: { value: null },
        uColor: { value: new THREE.Vector3() },
        uLight: { value: new THREE.Vector3(1, 1, 1) },
        uIntensity: { value: 0 },
        uGloss: { value: 0 },
        uRoughness: { value: 1 },
        uDetailPower: { value: 1 },
        uCoverageScale: { value: 1 },
        uMean: { value: 0.2 },
        uOpacity: { value: 0.98 },
        uPhotoMask: { value: 0 },
        uSparkle: { value: 0 },
        uCaptureLighting: { value: 0 },
        uResolution: { value: new THREE.Vector2() },
      },
    })
    this.detail = new THREE.ShaderMaterial({
      ...shared,
      vertexShader: QUAD_VERTEX,
      fragmentShader: DETAIL_FRAGMENT,
      uniforms: {
        uSource: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uFlipY: { value: 1 },
        uDetailRadius: { value: 1 },
      },
    })

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copy)
    this.quad.frustumCulled = false
  }

  setPhoto(bitmap: ImageBitmap, landmarks: NormalizedLandmark[] | null) {
    this.releasePhoto()

    this.size = { width: bitmap.width, height: bitmap.height }
    this.renderer.setSize(bitmap.width, bitmap.height, false)
    this.blend.uniforms.uResolution.value.set(bitmap.width, bitmap.height)

    const texture = new THREE.Texture(bitmap)
    texture.needsUpdate = true
    this.baseTexture = texture

    const options = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.targets = [
      new THREE.WebGLRenderTarget(bitmap.width, bitmap.height, options),
      new THREE.WebGLRenderTarget(bitmap.width, bitmap.height, options),
    ]
    this.detailTarget = new THREE.WebGLRenderTarget(bitmap.width, bitmap.height, options)
    this.means = landmarks ? regionalMeans(bitmap, landmarks) : new Map()
    const eyePixels = landmarks ? Math.hypot((landmarks[33].x - landmarks[263].x) * bitmap.width, (landmarks[33].y - landmarks[263].y) * bitmap.height) : bitmap.width * 0.25
    this.detail.uniforms.uDetailRadius.value = Math.max(0.35, eyePixels / 400)

    this.detail.uniforms.uSource.value = texture
    this.detail.uniforms.uTexel.value.set(1 / bitmap.width, 1 / bitmap.height)
    this.scene.clear()
    this.quad.material = this.detail
    this.scene.add(this.quad)
    this.renderer.setRenderTarget(this.detailTarget)
    this.renderer.render(this.scene, this.camera)

    this.blend.uniforms.uLight.value.set(...analysePhoto(bitmap).light)

    if (landmarks) {
      const mesh = new THREE.Mesh(buildFaceGeometry(landmarks), this.blend)
      mesh.frustumCulled = false
      this.faceMesh = mesh
    }
  }

  render(layers: CompositorLayer[]) {
    if (!this.baseTexture || !this.targets) return

    const inUse = new Set(layers.map(layer => layer.coverage))
    for (const [canvas, texture] of this.coverageTextures) {
      if (!inUse.has(canvas)) { texture.dispose(); this.coverageTextures.delete(canvas) }
    }
    const active = this.faceMesh ? layers.filter((layer) => layer.intensity > 0) : []

    if (active.length === 0) {
      this.drawQuad(this.baseTexture, null, true)
      return
    }

    // Normalise the photo into a render target first. Everything downstream then
    // reads and writes targets that share one orientation, so no pass has to know
    // that the ImageBitmap arrived upside down.
    this.drawQuad(this.baseTexture, this.targets[0], true)
    let read = 0

    for (const layer of active) {
      const write = 1 - read

      // Carry the backdrop forward, then overdraw just the face. Reading and
      // writing different targets keeps the shader out of a feedback loop.
      this.drawQuad(this.targets[read].texture, this.targets[write], false)

      const finish = FINISH_PARAMS[layer.finish]
      this.blend.uniforms.uBackdrop.value = this.targets[read].texture
      this.blend.uniforms.uDetail.value = this.detailTarget?.texture ?? null
      this.blend.uniforms.uMean.value = this.means.get(layer.region ?? 'lips') ?? 0.2
      this.blend.uniforms.uOpacity.value = layer.opacity ?? 0.98
      this.blend.uniforms.uPhotoMask.value = layer.photoSpace ? 1 : 0
      this.blend.uniforms.uSparkle.value = layer.surfaceMode ? 0 : finish.sparkle
      this.blend.uniforms.uCaptureLighting.value = layer.surfaceMode ? 1 : 0
      this.blend.uniforms.uCoverage.value = this.coverageTexture(layer.coverage)
      this.blend.uniforms.uColor.value.set(...layer.color)
      this.blend.uniforms.uIntensity.value = layer.intensity
      this.blend.uniforms.uGloss.value = layer.surfaceMode ? 0 : finish.gloss
      this.blend.uniforms.uRoughness.value = finish.roughness
      this.blend.uniforms.uDetailPower.value = finish.detail
      this.blend.uniforms.uCoverageScale.value = finish.coverage
      this.drawMesh(this.targets[write])

      read = write
    }

    this.drawQuad(this.targets[read].texture, null, false)
  }

  private drawQuad(
    source: THREE.Texture,
    target: THREE.WebGLRenderTarget | null,
    flipY: boolean,
  ) {
    this.copy.uniforms.uSource.value = source
    this.copy.uniforms.uFlipY.value = flipY ? 1 : 0
    this.scene.clear()
    this.quad.material = this.copy
    this.scene.add(this.quad)
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  private drawMesh(target: THREE.WebGLRenderTarget) {
    if (!this.faceMesh) return
    this.scene.clear()
    this.scene.add(this.faceMesh)
    this.renderer.setRenderTarget(target)
    // autoClear off so the copied backdrop survives underneath the mesh.
    this.renderer.autoClear = false
    this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = true
  }

  /**
   * Coverage canvases are reused frame to frame, so their textures are cached.
   *
   * A paint layer's canvas is mutated in place as the brush moves, and a cached
   * texture would keep showing the strokes as they were when it was first
   * uploaded. Marking it dirty on every use is the only thing that stays correct
   * for both kinds of coverage; the upload is skipped by the driver when nothing
   * changed, and re-uploading a 1024² mask is cheap next to getting it wrong.
   */
  private coverageTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    let texture = this.coverageTextures.get(canvas)
    if (!texture) {
      texture = new THREE.CanvasTexture(canvas)
      // The mask was authored in canvas coordinates; sample it the same way.
      texture.flipY = false
      texture.generateMipmaps = false
      texture.minFilter = THREE.LinearFilter
      this.coverageTextures.set(canvas, texture)
    }
    texture.needsUpdate = true
    return texture
  }

  get width() {
    return this.size.width
  }

  get height() {
    return this.size.height
  }

  dispose() {
    this.releasePhoto()
    this.quad.geometry.dispose()
    this.copy.dispose()
    this.blend.dispose()
    this.detail.dispose()
    this.renderer.dispose()
  }

  private releasePhoto() {
    this.baseTexture?.dispose()
    this.baseTexture = null
    this.faceMesh?.geometry.dispose()
    this.faceMesh = null
    this.targets?.forEach((target) => target.dispose())
    this.targets = null
    this.detailTarget?.dispose()
    this.detailTarget = null
    this.means.clear()
    this.coverageTextures.forEach((texture) => texture.dispose())
    this.coverageTextures.clear()
  }
}

function toLinear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Two things the shader needs that only the CPU can see whole.
 *
 * The light colour, because specular reflections mirror the light rather than
 * the surface: Image Metrics (US9449412B1) reads it off the brightest pixels
 * that are not clipped, clipped ones having lost the hue that identifies the
 * source. And the face's mid-tone, so pigment can be scaled around what this
 * particular photograph considers normally-lit skin.
 */
function analysePhoto(bitmap: ImageBitmap): {
  light: [number, number, number]
  midTone: number
} {
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { light: [1, 1, 1], midTone: 0.25 }

  context.drawImage(bitmap, 0, 0, size, size)
  const { data } = context.getImageData(0, 0, size, size)

  let red = 0
  let green = 0
  let blue = 0
  let midToneSum = 0
  let midToneCount = 0
  const inset = Math.round(size * 0.3)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      if (data[i] <= 250 || data[i + 1] <= 250 || data[i + 2] <= 250) {
        red = Math.max(red, data[i])
        green = Math.max(green, data[i + 1])
        blue = Math.max(blue, data[i + 2])
      }
      // The face fills the middle of a portrait; the border is background.
      if (x >= inset && x < size - inset && y >= inset && y < size - inset) {
        midToneSum +=
          0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2])
        midToneCount += 1
      }
    }
  }

  const peak = Math.max(red, green, blue, 1)
  return {
    light: [red / peak, green / peak, blue / peak],
    midTone: midToneCount > 0 ? midToneSum / midToneCount : 0.25,
  }
}
