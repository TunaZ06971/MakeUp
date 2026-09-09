/** Sampling quality is independent of recording. A bad frame never resets coverage. */
export const CAPTURE_PROTOCOL = 'continuous-rgb-v1'
export const MAX_CLIP_MS = 25_000
export const VIEW_NAMES = ['front', 'left', 'leftSide', 'right', 'rightSide', 'up', 'down'] as const
export type CaptureView = typeof VIEW_NAMES[number]
export interface Measurement {
  timeMs: number
  faceCount: number
  yaw: number
  pitch: number
  roll: number
  blink: number
  mouth: number
  brightness: number
  sharpness: number
  faceSize: number
  framed: boolean
}
export type Rejection = 'noFace' | 'oneFace' | 'framing' | 'lighting' | 'blur' | 'expression' | 'pose'
export function assessFrame(m: Measurement): { view?: CaptureView; score: number; issue?: Rejection } {
  const reject = (issue: Rejection) => ({ score: 0, issue })
  if (!Object.values(m).every(v => typeof v === 'boolean' || Number.isFinite(v)) || !m.faceCount) return reject('noFace')
  if (m.faceCount !== 1) return reject('oneFace')
  if (!m.framed || m.faceSize < .18 || m.faceSize > .82) return reject('framing')
  if (m.brightness < .12 || m.brightness > .92) return reject('lighting')
  if (m.sharpness < 5) return reject('blur')
  if (m.mouth > .3 || m.blink > .65) return reject('expression')
  if (Math.abs(m.roll) > .4 || Math.abs(m.pitch) > .65 || Math.abs(m.yaw) > 1.5) return reject('pose')
  const view: CaptureView = Math.abs(m.yaw) < .22
    ? m.pitch > .17 ? 'up' : m.pitch < -.17 ? 'down' : 'front'
    : m.yaw > 0 ? m.yaw > .6 ? 'leftSide' : 'left' : m.yaw < -.6 ? 'rightSide' : 'right'
  const score = Math.min(1, Math.log1p(m.sharpness) / 8) * .5 + (1 - Math.abs(m.brightness - .5)) * .3 + (1 - Math.abs(m.roll)) * .2
  return { view, score }
}

export interface RankedFrame { id: string; timeMs: number; view: CaptureView; score: number }
/** At most two separated frames per view; higher-quality observations can replace poorer ones. */
export function selectFrames<T extends RankedFrame>(previous: T[], candidate: T): T[] {
  const bucket = previous.filter(f => f.view === candidate.view)
  const near = bucket.find(f => Math.abs(f.timeMs - candidate.timeMs) < 700)
  const replace = near ?? (bucket.length >= 2 ? bucket.reduce((a, b) => a.score < b.score ? a : b) : undefined)
  if (replace && candidate.score <= replace.score) return previous
  return [...previous.filter(f => f.id !== replace?.id), candidate]
}

export function photoQuality(canvas: HTMLCanvasElement, bounds: number[]) {
  if (!bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return { brightness: 0, sharpness: 0 }
  const c = document.createElement('canvas'); c.width = c.height = 96
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, bounds[0] * canvas.width, bounds[1] * canvas.height, (bounds[2] - bounds[0]) * canvas.width, (bounds[3] - bounds[1]) * canvas.height, 0, 0, 96, 96)
  const pixels = ctx.getImageData(0, 0, 96, 96).data, gray = new Float32Array(96 * 96)
  let mean = 0, sharpness = 0
  for (let i = 0; i < gray.length; i++) { gray[i] = .2126 * pixels[4 * i] + .7152 * pixels[4 * i + 1] + .0722 * pixels[4 * i + 2]; mean += gray[i] }
  for (let y = 1; y < 95; y++) for (let x = 1; x < 95; x++) { const i = y * 96 + x; sharpness += (4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - 96] - gray[i + 96]) ** 2 }
  return { brightness: mean / gray.length / 255, sharpness: sharpness / (94 * 94) }
}
