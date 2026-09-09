import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { CANONICAL_UV, FACE_TRIANGLES } from './canonicalFace'
import type { Point } from './canonicalFace'

/**
 * Maps a point on a photo to its place in the shared UV space.
 *
 * This is what makes a brush stroke portable: the pointer lands somewhere on
 * *this* photo, but the stroke is recorded against the face's own topology. Play
 * the same stroke back on a different photo — a side view, or another person —
 * and it lands on the same anatomy.
 *
 * Triangles are bucketed into a coarse grid so a lookup touches a handful of
 * candidates instead of all 852.
 */
const GRID = 24

export class UVLookup {
  private readonly buckets: number[][] = Array.from({ length: GRID * GRID }, () => [])
  private readonly landmarks: NormalizedLandmark[]

  constructor(landmarks: NormalizedLandmark[]) {
    this.landmarks = landmarks

    for (let t = 0; t < FACE_TRIANGLES.length; t += 3) {
      const a = landmarks[FACE_TRIANGLES[t]]
      const b = landmarks[FACE_TRIANGLES[t + 1]]
      const c = landmarks[FACE_TRIANGLES[t + 2]]
      if (!a || !b || !c) continue

      const minX = Math.min(a.x, b.x, c.x)
      const maxX = Math.max(a.x, b.x, c.x)
      const minY = Math.min(a.y, b.y, c.y)
      const maxY = Math.max(a.y, b.y, c.y)

      for (let gy = cell(minY); gy <= cell(maxY); gy += 1) {
        for (let gx = cell(minX); gx <= cell(maxX); gx += 1) {
          this.buckets[gy * GRID + gx].push(t)
        }
      }
    }
  }

  /** Returns null when the point is off the face — nothing to paint there. */
  toUV(x: number, y: number): Point | null {
    if (x < 0 || x > 1 || y < 0 || y > 1) return null

    for (const t of this.buckets[cell(y) * GRID + cell(x)]) {
      const ia = FACE_TRIANGLES[t]
      const ib = FACE_TRIANGLES[t + 1]
      const ic = FACE_TRIANGLES[t + 2]
      const a = this.landmarks[ia]
      const b = this.landmarks[ib]
      const c = this.landmarks[ic]

      const bary = barycentric(x, y, a, b, c)
      if (!bary) continue

      const [u, v, w] = bary
      return {
        x: u * CANONICAL_UV[ia * 2] + v * CANONICAL_UV[ib * 2] + w * CANONICAL_UV[ic * 2],
        y: u * CANONICAL_UV[ia * 2 + 1] + v * CANONICAL_UV[ib * 2 + 1] + w * CANONICAL_UV[ic * 2 + 1],
      }
    }
    return null
  }
}

function cell(value: number): number {
  return Math.min(GRID - 1, Math.max(0, Math.floor(value * GRID)))
}

/** Barycentric weights, or null when the point falls outside the triangle. */
function barycentric(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): [number, number, number] | null {
  const v0x = b.x - a.x
  const v0y = b.y - a.y
  const v1x = c.x - a.x
  const v1y = c.y - a.y
  const denominator = v0x * v1y - v1x * v0y
  if (Math.abs(denominator) < 1e-12) return null

  const px = x - a.x
  const py = y - a.y
  const v = (px * v1y - v1x * py) / denominator
  const w = (v0x * py - px * v0y) / denominator
  const u = 1 - v - w

  const epsilon = -1e-6
  if (u < epsilon || v < epsilon || w < epsilon) return null
  return [u, v, w]
}
