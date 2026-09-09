import type { FaceScan } from './scanModel'
import type { TryOnLayer } from '../render-engine/TryOnCanvas'
import { MakeupCompositor } from '../render-engine/webglCompositor'
import { PhotoMasks } from '../render-engine/photoMasks'
import { bakeAtlas, decodeDataImage } from './reconstruction'
import { surfaceMaterial } from './surfaceMaterial'

export async function scanAppearance(scan: FaceScan, layers: TryOnLayer[], signal?: AbortSignal) {
  const images: HTMLCanvasElement[] = []
  const strokes = new Map<HTMLCanvasElement, HTMLCanvasElement>()
  for (const layer of layers) if (layer.kind === 'paint') {
    const source = layer.layer.canvas, snapshot = document.createElement('canvas')
    snapshot.width = source.width; snapshot.height = source.height
    snapshot.getContext('2d')!.drawImage(source, 0, 0)
    strokes.set(source, snapshot)
  }
  const check = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
  const compositor = layers.length ? new MakeupCompositor(document.createElement('canvas')) : null
  try {
    for (const frame of scan.frames) {
      check()
      const bitmap = await createImageBitmap(await decodeDataImage(frame.image))
      try {
        check()
        const landmarks = frame.landmarks?.map(p => ({ ...p, visibility: 1 }))
        compositor?.setPhoto(bitmap, landmarks ?? null)
        const masks = landmarks ? new PhotoMasks(bitmap.width, bitmap.height, landmarks) : null
        compositor?.render([...layers].sort((a, b) => a.order - b.order).flatMap(layer => {
          const coverage = layer.kind === 'region' ? masks?.get(layer.region) : strokes.get(layer.layer.canvas)
          return coverage ? [{ coverage, color: layer.color, intensity: layer.intensity, finish: layer.finish,
            region: layer.region, opacity: layer.opacity, photoSpace: layer.kind === 'region', surfaceMode: true }] : []
        }))
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
        canvas.getContext('2d')!.drawImage(compositor?.canvas ?? bitmap, 0, 0)
        images.push(canvas)
      } finally { bitmap.close() }
    }
  } finally { compositor?.dispose() }
  check()
  const atlas = await bakeAtlas(scan, layers.length ? images : undefined, { signal })
  const coating = layers.length ? await surfaceMaterial(scan, layers, signal, strokes) : null
  return { atlas, images, coating }
}
