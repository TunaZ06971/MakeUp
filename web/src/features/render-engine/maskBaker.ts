import type { ApplicableRegion } from '../../types/models'
import type { Point } from './canonicalFace'
import { CANONICAL_EYE_DISTANCE, REGION_SHAPES, type RegionShape } from './regions'

/**
 * Region masks live in canonical UV space, so they are identical for every face
 * and every photo — baked once for the whole session rather than per photo.
 *
 * 1024² is the sweet spot the research settled on: a 2048² mask costs 16 MB per
 * GPU upload and becomes the bottleneck while a brush is moving.
 */
const MASK_SIZE = 1024

const cache = new Map<ApplicableRegion, HTMLCanvasElement>()

export function regionMask(region: ApplicableRegion): HTMLCanvasElement | null {
  const cached = cache.get(region)
  if (cached) return cached

  const shape = REGION_SHAPES[region]
  if (!shape) return null

  const baked = bake(shape)
  cache.set(region, baked)
  return baked
}

/**
 * Fills the polygons and feathers the edge. The even-odd rule matters: lips are
 * an outer loop plus a reversed inner loop, so colour never lands on teeth.
 */
function bake(shape: RegionShape): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = MASK_SIZE
  canvas.height = MASK_SIZE

  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')

  const blur = shape.feather * CANONICAL_EYE_DISTANCE * MASK_SIZE
  if (blur > 0.5) context.filter = `blur(${blur.toFixed(2)}px)`

  const path = new Path2D()
  for (const polygon of shape.polygons) {
    appendPolygon(path, polygon)
  }

  context.fillStyle = '#fff'
  context.fill(path, 'evenodd')

  normalisePeak(context)
  return canvas
}

/**
 * Rescales the mask so its strongest point reaches full opacity.
 *
 * Blurring a narrow region — an eyelid, a lash line — spreads its alpha out and
 * leaves the whole mask semi-transparent, which silently caps how much product
 * can ever be applied there. Normalising keeps feather as a purely cosmetic edge
 * treatment: intensity 100% means 100% everywhere.
 */
function normalisePeak(context: CanvasRenderingContext2D) {
  const image = context.getImageData(0, 0, MASK_SIZE, MASK_SIZE)
  const data = image.data

  let peak = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > peak) peak = data[i]
  }
  if (peak === 0 || peak === 255) return

  const gain = 255 / peak
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.round(data[i] * gain))
  }
  context.putImageData(image, 0, 0)
}

function appendPolygon(path: Path2D, polygon: Point[]) {
  if (polygon.length < 3) return
  path.moveTo(polygon[0].x * MASK_SIZE, polygon[0].y * MASK_SIZE)
  for (const point of polygon.slice(1)) {
    path.lineTo(point.x * MASK_SIZE, point.y * MASK_SIZE)
  }
  path.closePath()
}

export { MASK_SIZE }
