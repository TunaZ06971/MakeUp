import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { ApplicableRegion } from '../../types/models'
import { buildRegionShapes } from './regions'

/** Automatic makeup is rasterised at the photo's resolution, not stretched from a UV atlas. */
export class PhotoMasks {
  private cache = new Map<ApplicableRegion, HTMLCanvasElement>()
  private shapes
  private eyeDistance
  private width: number
  private height: number
  constructor(width: number, height: number, landmarks: NormalizedLandmark[]) {
    this.width = width; this.height = height
    const point = (i: number) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height })
    this.shapes = buildRegionShapes(point)
    this.eyeDistance = Math.hypot(point(33).x - point(263).x, point(33).y - point(263).y)
  }
  get(region: ApplicableRegion): HTMLCanvasElement {
    const cached = this.cache.get(region)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = this.width; canvas.height = this.height
    const context = canvas.getContext('2d')!
    const shape = this.shapes[region]
    const path = new Path2D()
    for (const polygon of shape.polygons) {
      path.moveTo(polygon[0].x, polygon[0].y)
      if (region === 'lips') {
        for (let i = 0; i < polygon.length; i++) {
          const p0 = polygon[(i + polygon.length - 1) % polygon.length], p1 = polygon[i]
          const p2 = polygon[(i + 1) % polygon.length], p3 = polygon[(i + 2) % polygon.length]
          path.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
            p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y)
        }
      } else for (const p of polygon.slice(1)) path.lineTo(p.x, p.y)
      path.closePath()
    }
    const blur = Math.max(0.5, shape.feather * this.eyeDistance)
    context.filter = `blur(${blur}px)`
    context.fillStyle = '#fff'
    context.fill(path, 'evenodd')
    // Lips and liner get inward-only feathering. Blurring must never bleed over their outline.
    if (['lips', 'eyelidLine', 'waterline', 'faceFull'].includes(region)) {
      context.filter = 'none'
      context.globalCompositeOperation = 'destination-in'
      context.fill(path, 'evenodd')
    }
    this.cache.set(region, canvas)
    return canvas
  }
}

/** Weighted regional luminance in linear light; excludes background and mouth/eye holes. */
export function regionalMeans(bitmap: ImageBitmap, landmarks: NormalizedLandmark[]): Map<ApplicableRegion, number> {
  const width = 256, height = Math.max(1, Math.round(width * bitmap.height / bitmap.width))
  const photo = document.createElement('canvas')
  photo.width = width; photo.height = height
  const context = photo.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const masks = new PhotoMasks(width, height, landmarks)
  const result = new Map<ApplicableRegion, number>()
  const linear = (b: number) => b / 255 <= 0.04045 ? b / 255 / 12.92 : ((b / 255 + 0.055) / 1.055) ** 2.4
  for (const region of Object.keys(buildRegionShapes((i) => landmarks[i])) as ApplicableRegion[]) {
    const alpha = masks.get(region).getContext('2d')!.getImageData(0, 0, width, height).data
    let sum = 0, weight = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const w = alpha[i + 3] / 255
      sum += (0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2])) * w
      weight += w
    }
    result.set(region, weight > 0 ? Math.max(0.015, sum / weight) : 0.2)
  }
  return result
}
