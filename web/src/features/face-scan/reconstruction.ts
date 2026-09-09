import { Vector3 } from 'three'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { CANONICAL_UV } from '../render-engine/canonicalFace'
import modelTopology from './modelTriangles.json'
export const MODEL_TRIANGLES = modelTopology.triangles
import type { FaceScan, ScanFrame } from './scanModel'

export function faceCoordinates(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  matrix?: number[],
) {
  const camera = landmarks
    .slice(0, 468)
    .map(
      (p) =>
        new Vector3((p.x - 0.5) * width, (0.5 - p.y) * height, -p.z * width),
    )
  const center = camera[33].clone().add(camera[263]).multiplyScalar(0.5)
  const x = matrix
    ? new Vector3(matrix[0], matrix[1], matrix[2]).normalize()
    : camera[263].clone().sub(camera[33]).normalize()
  const up = matrix
    ? new Vector3(matrix[4], matrix[5], matrix[6])
    : camera[10].clone().sub(center)
  const y = up.addScaledVector(x, -up.dot(x)).normalize()
  const z = new Vector3().crossVectors(x, y).normalize()
  const scale = camera[33].distanceTo(camera[263])
  const vertices = camera.flatMap((p) => {
    const d = p.clone().sub(center).divideScalar(scale)
    return [d.dot(x), d.dot(y), d.dot(z)]
  })
  return {
    vertices,
    camera,
    yaw: Math.atan2(z.x, z.z),
    pitch: Math.atan2(z.y, Math.hypot(z.x, z.z)),
    roll: Math.atan2(x.y, x.x),
  }
}
export function frameWeights(
  camera: Vector3[],
  triangles: ArrayLike<number>,
): number[] {
  const weights: number[] = []
  for (let t = 0; t < triangles.length; t += 3) {
    const a = camera[triangles[t]],
      b = camera[triangles[t + 1]],
      c = camera[triangles[t + 2]]
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    weights.push(Math.max(0, n.z / Math.max(1e-9, n.length())) ** 4)
  }
  return weights
}
/** Only neutral frames are fused. Expression captures never change identity geometry. */
export function fuseVertices(frames: ScanFrame[]): number[] {
  if (!frames.length) throw new Error('No neutral frames')
  return frames[0].vertices.map((_, i) => {
    const values = frames.map((f) => f.vertices[i]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  })
}
export function newRGBScan(
  frames: ScanFrame[],
  expressions: FaceScan['expressions'],
  completedSteps: string[],
): FaceScan {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: 'mediapipe-rgb',
    units: 'relative',
    vertices: fuseVertices(frames),
    uv: Array.from(CANONICAL_UV),
    triangles: MODEL_TRIANGLES,
    frames,
    expressions,
    texture: '',
    completedSteps,
  }
}
export async function decodeDataImage(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}
/** Bake a continuous, exposure-matched appearance field off the UI thread. */
const gainsCache = new WeakMap<object, number[][]>()
export async function bakeAtlas(
  scan: Pick<FaceScan, 'uv' | 'triangles' | 'frames'>,
  images?: CanvasImageSource[],
  options: { signal?: AbortSignal; colour?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const originals = !images || (!gainsCache.has(scan.frames) && options.colour !== false)
    ? await Promise.all(scan.frames.map(f => decodeDataImage(f.image))) : undefined
  const sources = images ?? originals!
  const pixels = (source: CanvasImageSource) => {
    const image = source as HTMLImageElement | HTMLCanvasElement
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0)
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
  }
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const input = {
    uv: scan.uv, triangles: scan.triangles, frames: scan.frames.map(({ projection, weights, step }) => ({ projection, weights, step })),
    size: 1024, images: sources.map(pixels), colour: options.colour,
    gains: options.colour === false ? scan.frames.map(() => [1, 1, 1]) : gainsCache.get(scan.frames),
    calibration: images && originals ? originals.map(pixels) : undefined,
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./atlas.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    options.signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message)) }
    worker.onmessage = ({ data: result }) => {
      cleanup()
      if (result.error) { reject(new Error(result.error)); return }
      if (options.colour !== false) gainsCache.set(scan.frames, result.gains)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1024
      canvas.getContext('2d')!.putImageData(new ImageData(result.data, 1024, 1024), 0, 0)
      resolve(canvas)
    }
    const transfers = [...input.images, ...(input.calibration ?? [])].map(im => im.data.buffer)
    worker.postMessage(input, transfers)
  })
}
