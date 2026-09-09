import data from './canonicalFace.json'

/**
 * The fixed face topology every platform shares.
 *
 * Because the triangulation and its UV unwrap are identical for every face, a
 * mask or a brush stroke recorded in this UV space lands in the same anatomical
 * place on any photo, at any angle, on any device. That is what lets one look
 * replay across views — and across users.
 *
 * Regenerate with `npm run canonical` at the repo root.
 */
export const CANONICAL_VERTEX_COUNT = data.vertexCount

/** Flat [u0, v0, u1, v1, …], one pair per landmark index. */
export const CANONICAL_UV = new Float32Array(data.uv)

/** Flat triangle indices. Eyes and mouth are left open so paint cannot land on eyeballs or teeth. */
export const FACE_TRIANGLES = new Uint16Array(data.triangles)

export interface Point {
  x: number
  y: number
}

export function canonicalUV(index: number): Point {
  return { x: CANONICAL_UV[index * 2], y: CANONICAL_UV[index * 2 + 1] }
}
