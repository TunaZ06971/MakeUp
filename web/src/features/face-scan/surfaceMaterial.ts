import { CANONICAL_UV } from '../render-engine/canonicalFace'
import { PhotoMasks } from '../render-engine/photoMasks'
import { FINISH_PARAMS } from '../render-engine/shaders/finishes'
import type { TryOnLayer } from '../render-engine/TryOnCanvas'
import { UVLookup } from '../render-engine/uvLookup'
import type { FaceScan } from './scanModel'
import { bakeAtlas } from './reconstruction'

/** R = coating strength, G = coating roughness. No invented pore/normal texture. */
export async function surfaceMaterial(scan: FaceScan, layers: TryOnLayer[], signal?: AbortSignal, strokes?: Map<HTMLCanvasElement, HTMLCanvasElement>) {
  const size = 512, canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!, data = ctx.createImageData(size, size)
  const masks = new PhotoMasks(size, size, Array.from({ length: 468 }, (_, v) => ({
    x: CANONICAL_UV[v * 2], y: CANONICAL_UV[v * 2 + 1], z: 0, visibility: 1,
  })))
  for (let i = 0; i < data.data.length; i += 4) { data.data[i + 1] = 255; data.data[i + 3] = 255 }
  for (const layer of [...layers].sort((a, b) => a.order - b.order)) {
    const coverage = layer.kind === 'region' ? masks.get(layer.region) : strokes?.get(layer.layer.canvas) ?? layer.layer.canvas
    const scratch = document.createElement('canvas'); scratch.width = scratch.height = size
    const context = scratch.getContext('2d')!; context.drawImage(coverage, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data, finish = FINISH_PARAMS[layer.finish]
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + (layer.kind === 'region' ? 3 : 0)] / 255 * layer.intensity * (layer.opacity ?? 1)
      data.data[i] = data.data[i] * (1 - alpha) + Math.min(1, finish.gloss * 1.6) * alpha * 255
      data.data[i + 1] = data.data[i + 1] * (1 - alpha) + finish.roughness * alpha * 255
    }
  }
  ctx.putImageData(data, 0, 0)
  const frames = scan.frames.map(frame => {
    const lookup = frame.landmarks ? new UVLookup(frame.landmarks.map(p => ({ ...p, visibility: 1 }))) : null
    const projection = Array.from({ length: scan.vertices.length / 3 }, (_, v) => {
      const p = lookup?.toUV(frame.projection[v * 2], frame.projection[v * 2 + 1])
      return p ? [p.x, p.y] : [-1, -1]
    }).flat()
    return { ...frame, projection }
  })
  return bakeAtlas({ ...scan, frames }, frames.map(() => canvas), { colour: false, signal })
}
