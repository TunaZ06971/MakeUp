import type { ApplicableRegion } from '../../types/models'
import { canonicalUV, type Point } from './canonicalFace'

export interface RegionShape {
  /** Closed polygons in canonical UV space (eyes and cheeks come in pairs). */
  polygons: Point[][]
  /** Feather radius as a fraction of the canonical inter-eye distance. */
  feather: number
}

// MediaPipe Face Mesh indices. Each list walks a closed loop in order so it can
// be filled directly as a polygon. Every index is < 468, because the canonical
// model has no iris vertices.
const OUTER_LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
]
const INNER_LIPS = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
]
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
const LEFT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133]
const RIGHT_EYE_UPPER = [263, 466, 388, 387, 386, 385, 384, 398, 362]
const LEFT_BROW_LOWER = [46, 53, 52, 65, 55]
const RIGHT_BROW_LOWER = [285, 295, 282, 283, 276]
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

// Anchors for the regions the mesh has no outline for.
const LEFT_EYE_OUTER = 33
const RIGHT_EYE_OUTER = 263
const LEFT_CHEEK_ANCHOR = 50
const RIGHT_CHEEK_ANCHOR = 280
const NOSE_TIP = 4
const NOSE_BRIDGE_TOP = 168
const CUPIDS_BOW_CENTER = 0



/**
 * Scale reference for the heuristic regions. In canonical space this is a
 * constant, so blush and contour sit in the same anatomical place for everyone —
 * no per-photo estimation, and nothing to drift between platforms.
 */
export const CANONICAL_EYE_DISTANCE = (() => {
  const left = canonicalUV(LEFT_EYE_OUTER)
  const right = canonicalUV(RIGHT_EYE_OUTER)
  return Math.hypot(right.x - left.x, right.y - left.y)
})()

function ellipse(center: Point, radiusX: number, radiusY: number, rotation = 0): Point[] {
  const steps = 24
  const points: Point[] = []
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    const x = Math.cos(angle) * radiusX
    const y = Math.sin(angle) * radiusY
    points.push({
      x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
      y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation),
    })
  }
  return points
}

/** Lips minus the mouth opening, so colour never lands on teeth. */


/** The lid: bounded below by the lash line and above by the brow. */
/**
 * Fixed for every face and every photo, so this is computed once. Consumers bake
 * these into UV-space masks that all views then share.
 */
export function buildRegionShapes(pointAt: (index: number) => Point): Record<ApplicableRegion, RegionShape> {
  const pick = (indices: number[]) => indices.map(pointAt)
  const left = pointAt(33), right = pointAt(263)
  const scale = Math.hypot(right.x - left.x, right.y - left.y)
  const up = { x: (right.y - left.y) / scale, y: -(right.x - left.x) / scale }
  function eyelidShape(upper: number[], browIndices: number[], lift: number) {
    const lash = pick(upper)
    const brow = pick(browIndices)
    if (Math.hypot(lash[0].x - brow[0].x, lash[0].y - brow[0].y) >
        Math.hypot(lash[0].x - brow.at(-1)!.x, lash[0].y - brow.at(-1)!.y)) brow.reverse()
    const ceiling = lash.map((p, i) => {
      const f = i / (lash.length - 1) * (brow.length - 1)
      const a = brow[Math.floor(f)], b = brow[Math.min(Math.floor(f) + 1, brow.length - 1)]
      const q = { x: a.x + (b.x - a.x) * (f % 1), y: a.y + (b.y - a.y) * (f % 1) }
      // Taper at the corners instead of crossing the eye or brow.
      const amount = lift * Math.sin(Math.PI * i / (lash.length - 1)) ** 0.5
      return { x: p.x + (q.x - p.x) * amount, y: p.y + (q.y - p.y) * amount }
    })
    return [...lash, ...ceiling.reverse()]
  }
  function liner(indices: number[], direction: number) {
    const line = pick(indices)
    const edge = line.map((p, i) => {
      const width = scale * 0.012 * Math.sin(Math.PI * i / (line.length - 1))
      return { x: p.x + up.x * width * direction, y: p.y + up.y * width * direction }
    })
    return [...line, ...edge.reverse()]
  }
  const leftCheek = pointAt(LEFT_CHEEK_ANCHOR)
  const rightCheek = pointAt(RIGHT_CHEEK_ANCHOR)
  const noseTip = pointAt(NOSE_TIP)
  const noseTop = pointAt(NOSE_BRIDGE_TOP)
  const bow = pointAt(CUPIDS_BOW_CENTER)

  return {
    lips: { polygons: [pick(OUTER_LIPS), pick(INNER_LIPS)], feather: 0.003 },

    eyelid: {
      polygons: [
        eyelidShape(LEFT_EYE_UPPER, LEFT_BROW_LOWER, 0.65),
        eyelidShape(RIGHT_EYE_UPPER, RIGHT_BROW_LOWER, 0.65),
      ],
      feather: 0.035,
    },

    // The crease reaches higher toward the brow than the lid does.
    crease: {
      polygons: [
        eyelidShape(LEFT_EYE_UPPER, LEFT_BROW_LOWER, 0.95),
        eyelidShape(RIGHT_EYE_UPPER, RIGHT_BROW_LOWER, 0.95),
      ],
      feather: 0.05,
    },

    eyelidLine: { polygons: [liner(LEFT_EYE_UPPER, 1), liner(RIGHT_EYE_UPPER, 1)], feather: 0.002 },
    waterline: { polygons: [liner(LEFT_EYE.slice(0, 9), -1), liner([263, 249, 390, 373, 374, 380, 381, 382, 362], -1)], feather: 0.002 },

    eyebrows: { polygons: [pick(LEFT_BROW), pick(RIGHT_BROW)], feather: 0.015 },

    // Soft ellipses on the apples of the cheeks, tilted along the cheekbone.
    cheeks: {
      polygons: [
        ellipse(leftCheek, scale * 0.34, scale * 0.24, -0.25),
        ellipse(rightCheek, scale * 0.34, scale * 0.24, 0.25),
      ],
      feather: 0.08,
    },

    // Higher and narrower than blush, angled up toward the temples.
    cheekbones: {
      polygons: [
        ellipse(
          { x: leftCheek.x - scale * 0.06, y: leftCheek.y - scale * 0.18 },
          scale * 0.3,
          scale * 0.1,
          -0.32,
        ),
        ellipse(
          { x: rightCheek.x + scale * 0.06, y: rightCheek.y - scale * 0.18 },
          scale * 0.3,
          scale * 0.1,
          0.32,
        ),
      ],
      feather: 0.06,
    },

    noseBridge: {
      polygons: [
        ellipse(
          { x: (noseTip.x + noseTop.x) / 2, y: (noseTip.y + noseTop.y) / 2 },
          scale * 0.055,
          Math.hypot(noseTip.x - noseTop.x, noseTip.y - noseTop.y) / 2,
        ),
      ],
      feather: 0.05,
    },

    cupidsBow: {
      polygons: [ellipse({ x: bow.x, y: bow.y - scale * 0.05 }, scale * 0.11, scale * 0.045)],
      feather: 0.06,
    },

    faceFull: { polygons: [pick(FACE_OVAL), pick(OUTER_LIPS), pick(LEFT_EYE), pick(RIGHT_EYE), pick(LEFT_BROW), pick(RIGHT_BROW)], feather: 0.015 },
  }
}

export const REGION_SHAPES = buildRegionShapes(canonicalUV)
