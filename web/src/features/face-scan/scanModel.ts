import { openDB } from 'idb'
export interface ScanFrame {
  step: string
  image: string // local JPEG data URL, never an external URL
  projection: number[] // normalized image x,y for every mesh vertex
  weights: number[] // per-triangle visibility/quality
  vertices: number[] // neutral head-local coordinates
  landmarks?: { x: number; y: number; z: number }[] // optional standard 468 recipe coordinates
}
export interface FaceScan {
  schemaVersion: 1
  id: string
  createdAt: string
  source: 'mediapipe-rgb' | 'arkit-truedepth' | 'arkit-rgb' | 'truedepth-measured'
  units: 'relative' | 'meters'
  vertices: number[]
  uv: number[] // standard UV, V points up
  triangles: number[]
  frames: ScanFrame[]
  expressions: { blink?: number[]; mouth?: number[] }
  texture: string
  completedSteps: string[]
}
const finite = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.every((x) => typeof x === 'number' && Number.isFinite(x))
const localImage = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length < 12_000_000 &&
  /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v)
export function validateScan(value: unknown): FaceScan {
  const s = value as FaceScan
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !['mediapipe-rgb', 'arkit-truedepth', 'arkit-rgb', 'truedepth-measured'].includes(s.source) ||
    !['meters', 'relative'].includes(s.units) ||
    typeof s.id !== 'string' ||
    s.id.length > 100 ||
    typeof s.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(s.createdAt)) ||
    !finite(s.vertices) ||
    s.vertices.length < 9 ||
    s.vertices.length > (s.source === 'truedepth-measured' ? 196608 : 30000) ||
    s.vertices.length % 3 ||
    !finite(s.uv) ||
    s.uv.length !== (s.vertices.length / 3) * 2 ||
    s.uv.some((x) => x < 0 || x > 1) ||
    !finite(s.triangles) ||
    s.triangles.length > (s.source === 'truedepth-measured' ? 400000 : 180000) ||
    s.triangles.length % 3 ||
    !s.triangles.length ||
    s.triangles.some(
      (x) => !Number.isInteger(x) || x < 0 || x >= s.vertices.length / 3,
    ) ||
    !localImage(s.texture) ||
    !Array.isArray(s.frames) ||
    s.frames.length < 3 ||
    s.frames.length > 12 ||
    !Array.isArray(s.completedSteps) ||
    s.completedSteps.some((x) => typeof x !== 'string') ||
    !s.expressions ||
    typeof s.expressions !== 'object'
  )
    throw new Error('Invalid scan')
  if (s.vertices.some((v) => Math.abs(v) > 100))
    throw new Error('Invalid geometry scale')
  for (const f of s.frames) {
    if (
      typeof f.step !== 'string' ||
      !localImage(f.image) ||
      !finite(f.projection) ||
      f.projection.length !== s.uv.length ||
      !finite(f.weights) ||
      f.weights.length !== s.triangles.length / 3 ||
      f.weights.some((x) => x < 0 || x > 1) ||
      !finite(f.vertices) ||
      f.vertices.length !== s.vertices.length
    )
      throw new Error('Invalid frame')
    if (
      f.landmarks &&
      (!Array.isArray(f.landmarks) ||
        f.landmarks.length < 468 ||
        f.landmarks.length > 478 ||
        f.landmarks.some((p) => ![p.x, p.y, p.z].every(Number.isFinite)))
    )
      throw new Error('Invalid landmarks')
  }
  for (const shape of Object.values(s.expressions))
    if (!finite(shape) || shape.length !== s.vertices.length)
      throw new Error('Invalid expression')
  return s
}
const database = () =>
  openDB('makeup-face-scans', 1, {
    upgrade(db) {
      db.createObjectStore('scans')
    },
  })
export async function saveScan(uid: string, scan: FaceScan) {
  await (await database()).put('scans', validateScan(scan), uid)
}
export async function loadScan(uid: string): Promise<FaceScan | null> {
  const value = await (await database()).get('scans', uid)
  return value ? validateScan(value) : null
}
export async function removeScan(uid: string) {
  await (await database()).delete('scans', uid)
}
export async function readScan(file: File) {
  if (file.size > 100_000_000) throw new Error('Scan too large')
  return validateScan(JSON.parse(await file.text()))
}
export function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
