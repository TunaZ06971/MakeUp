import { MASK_SIZE } from './maskBaker'

export interface StrokePoint {
  u: number
  v: number
  startsSegment?: boolean
}

/**
 * A brush stroke, recorded in canonical UV space rather than photo pixels.
 *
 * Stored this way a look is a recipe, not a picture: it replays onto a side
 * view, onto a new photo, or onto someone else's face, and still lands on the
 * same lip or the same cheekbone. It is also tiny compared with saving the
 * painted texture, which matters because face photos never leave the device.
 */
export interface Stroke {
  productId: string
  colorIndex: number
  /** Brush radius in UV units (0..1 across the whole face atlas). */
  radius: number
  /** 0..1 opacity the finished stroke contributes. */
  flow: number
  points: StrokePoint[]
}

/**
 * Accumulates strokes into a UV-space coverage canvas the compositor samples.
 *
 * Three buffers, because one is not enough to make a brush feel right:
 * `committed` holds finished strokes, `scratch` holds the stroke in progress at
 * full opacity, and `canvas` is what the renderer reads. Stamps along a single
 * stroke therefore never darken each other where they overlap — one pass of the
 * brush reads as one even layer, the way real product does — while the stroke
 * still appears live under the pointer.
 */
export class PaintLayer {
  readonly canvas: HTMLCanvasElement
  private readonly output: CanvasRenderingContext2D
  private readonly committed: HTMLCanvasElement
  private readonly committedContext: CanvasRenderingContext2D
  private readonly scratch: HTMLCanvasElement
  private readonly scratchContext: CanvasRenderingContext2D
  private flow = 1

  constructor() {
    this.canvas = createCanvas()
    this.output = context2d(this.canvas)
    this.committed = createCanvas()
    this.committedContext = context2d(this.committed)
    this.scratch = createCanvas()
    this.scratchContext = context2d(this.scratch)
    this.scratchContext.globalCompositeOperation = 'lighten'
    this.clear()
  }

  clear() {
    this.committedContext.fillStyle = '#000'
    this.committedContext.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.scratchContext.globalCompositeOperation = 'copy'
    this.scratchContext.fillStyle = '#000'
    this.scratchContext.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.scratchContext.globalCompositeOperation = 'lighten'
    this.compose()
  }

  beginStroke(flow: number) {
    this.flow = clamp01(flow)
    this.scratchContext.globalCompositeOperation = 'copy'
    this.scratchContext.fillStyle = '#000'
    this.scratchContext.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.scratchContext.globalCompositeOperation = 'lighten'
  }

  /**
   * Interpolates between samples so a fast drag stays a continuous line instead
   * of a row of dots.
   */
  extendStroke(from: StrokePoint | null, to: StrokePoint, radius: number) {
    if (!from) {
      this.stamp(to, radius)
    } else {
      const distance = Math.hypot(to.u - from.u, to.v - from.v)
      const step = Math.max(radius * 0.25, 1 / MASK_SIZE)
      const count = Math.max(1, Math.ceil(distance / step))
      for (let i = 1; i <= count; i += 1) {
        const t = i / count
        this.stamp({ u: from.u + (to.u - from.u) * t, v: from.v + (to.v - from.v) * t }, radius)
      }
    }
    this.compose()
  }

  endStroke() {
    this.committedContext.globalCompositeOperation = 'lighter'
    this.committedContext.globalAlpha = this.flow
    this.committedContext.drawImage(this.scratch, 0, 0)
    this.committedContext.globalAlpha = 1
    this.committedContext.globalCompositeOperation = 'source-over'
    this.scratchContext.globalCompositeOperation = 'copy'
    this.scratchContext.fillStyle = '#000'
    this.scratchContext.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.scratchContext.globalCompositeOperation = 'lighten'
    this.compose()
  }

  cancelStroke() {
    this.scratchContext.globalCompositeOperation = 'copy'
    this.scratchContext.fillStyle = '#000'
    this.scratchContext.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.scratchContext.globalCompositeOperation = 'lighten'
    this.compose()
  }

  /** Replays a whole stroke — used when loading a saved look. */
  replay(stroke: Stroke) {
    this.beginStroke(stroke.flow)
    let previous: StrokePoint | null = null
    for (const point of stroke.points) {
      this.extendStroke(point.startsSegment ? null : previous, point, stroke.radius)
      previous = point
    }
    this.endStroke()
  }

  private stamp(point: StrokePoint, radius: number) {
    const x = point.u * MASK_SIZE
    const y = point.v * MASK_SIZE
    const r = Math.max(radius * MASK_SIZE, 1)

    // Soft-edged brush: opaque core fading to nothing at the rim.
    const gradient = this.scratchContext.createRadialGradient(x, y, r * 0.3, x, y, r)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgb(0,0,0)')

    this.scratchContext.fillStyle = gradient
    this.scratchContext.beginPath()
    this.scratchContext.arc(x, y, r, 0, Math.PI * 2)
    this.scratchContext.fill()
  }

  private compose() {
    this.output.clearRect(0, 0, MASK_SIZE, MASK_SIZE)
    this.output.globalCompositeOperation = 'source-over'
    this.output.drawImage(this.committed, 0, 0)
    this.output.globalCompositeOperation = 'lighter'
    this.output.globalAlpha = this.flow
    this.output.drawImage(this.scratch, 0, 0)
    this.output.globalAlpha = 1
  }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = MASK_SIZE
  canvas.height = MASK_SIZE
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  return context
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
