import { openDB } from 'idb'
import { CAPTURE_PROTOCOL, VIEW_NAMES, type RankedFrame } from './selection'

export const MAX_CAPTURE_BYTES = 90_000_000
export const MAX_SEGMENTS = 4
export interface CaptureFrame extends RankedFrame {
  segmentId: string
  yaw: number
  pitch: number
  roll: number
  image: Blob
  landmarks: { x: number; y: number; z: number }[]
}
export interface CaptureSegment {
  id: string
  createdAt: string
  durationMs: number
  width: number
  height: number
  video: Blob
  frames: CaptureFrame[]
  analyzedFrames: number
  rejected: Record<string, number>
  ended: 'user' | 'timeLimit' | 'background' | 'cameraEnded' | 'error'
}
export interface HeadCapture {
  schemaVersion: 1
  kind: 'makeup-head-capture'
  protocol: typeof CAPTURE_PROTOCOL
  id: string
  createdAt: string
  updatedAt: string
  intendedSide: 'left' | 'right'
  segments: CaptureSegment[]
  // Capture quality is never substituted for model reconstruction or measured coverage.
  reconstruction: 'not-run'
}
const safeId = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{1,80}$/.test(s)
const date = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s))
const number = (v: unknown, low: number, high: number) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high
export function captureBytes(c: HeadCapture) { return c.segments.reduce((n, s) => n + s.video.size + s.frames.reduce((a, f) => a + f.image.size, 0), 0) }
export function validateCapture(value: unknown): HeadCapture {
  const c = value as HeadCapture
  if (!c || c.schemaVersion !== 1 || c.kind !== 'makeup-head-capture' || c.protocol !== CAPTURE_PROTOCOL || !safeId(c.id) || !date(c.createdAt) || !date(c.updatedAt) || !['left', 'right'].includes(c.intendedSide) || c.reconstruction !== 'not-run' || !Array.isArray(c.segments) || !c.segments.length || c.segments.length > MAX_SEGMENTS) throw Error('Invalid capture')
  const ids = new Set<string>()
  for (const s of c.segments) {
    if (!safeId(s.id) || ids.has(s.id) || !date(s.createdAt) || !number(s.durationMs, 1, 35_000) || !number(s.width, 1, 4096) || !number(s.height, 1, 4096) || !(s.video instanceof Blob) || !/^video\/(webm|mp4)(;.*)?$/.test(s.video.type) || !s.video.size || !Array.isArray(s.frames) || s.frames.length > 14 || !number(s.analyzedFrames, 0, 10_000) || !s.rejected || !Object.values(s.rejected).every(n => number(n, 0, 10_000)) || !['user', 'timeLimit', 'background', 'cameraEnded', 'error'].includes(s.ended)) throw Error('Invalid clip')
    ids.add(s.id)
    for (const f of s.frames) {
      if (!safeId(f.id) || ids.has(f.id) || f.segmentId !== s.id || !(f.image instanceof Blob) || f.image.type !== 'image/jpeg' || f.image.size > 4_000_000 || !f.image.size || !VIEW_NAMES.includes(f.view) || !number(f.timeMs, 0, s.durationMs + 100) || !number(f.score, 0, 2) || ![f.yaw, f.pitch, f.roll].every(v => number(v, -Math.PI, Math.PI)) || !Array.isArray(f.landmarks) || f.landmarks.length < 468 || f.landmarks.length > 478 || f.landmarks.some(p => !p || ![p.x, p.y, p.z].every(v => number(v, -10, 10)))) throw Error('Invalid keyframe')
      ids.add(f.id)
    }
  }
  if (captureBytes(c) > MAX_CAPTURE_BYTES) throw Error('Capture too large')
  return c
}
function database() { return openDB('makeup-head-captures', 1, { upgrade(db) { db.createObjectStore('captures') } }) }
export async function loadCapture(owner: string): Promise<HeadCapture | null> { const value = await (await database()).get('captures', owner); return value ? validateCapture(value) : null }
export async function saveCapture(owner: string, c: HeadCapture) { await (await database()).add('captures', validateCapture(c), owner) }
export async function deleteCapture(owner: string) { await (await database()).delete('captures', owner) }
export async function appendSegment(owner: string, segment: CaptureSegment, side: 'left' | 'right') {
  const db = await database(), tx = db.transaction('captures', 'readwrite'), previous = await tx.store.get(owner) as HeadCapture | undefined
  const now = new Date().toISOString()
  const c: HeadCapture = { schemaVersion: 1, kind: 'makeup-head-capture', protocol: CAPTURE_PROTOCOL, id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now, intendedSide: previous?.intendedSide ?? side, segments: [...(previous?.segments ?? []), segment], reconstruction: 'not-run' }
  try { validateCapture(c); await tx.store.put(c, owner); await tx.done; return c }
  catch (error) { try { tx.abort() } catch { /* Already aborted by storage failure. */ } await tx.done.catch(() => {}); throw error }
}
