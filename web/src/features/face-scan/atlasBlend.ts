/** A continuous blend field shared by adjacent triangles. All colour math is linear light. */
export interface AtlasPixels { width: number; height: number; data: Uint8ClampedArray }
export interface AtlasInput {
  uv: number[]; triangles: number[]; size: number
  frames: { projection: number[]; weights: number[]; step: string }[]
  images: AtlasPixels[]
  calibration?: AtlasPixels[]
  gains?: number[][]
  colour?: boolean
}
const linear = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
})
const encode = (x: number) => Math.round(255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - .055))

export function blendFields(input: Pick<AtlasInput, 'uv' | 'triangles' | 'frames'>) {
  const n = input.uv.length / 2, counts = new Uint16Array(n)
  const fields = input.frames.map(() => new Float32Array(n))
  for (let t = 0; t < input.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = input.triangles[t + k]
      counts[v]++
      fields.forEach((field, f) => { field[v] += input.frames[f].weights[t / 3] })
    }
  }
  const front = Math.max(0, input.frames.findIndex(f => f.step === 'front'))
  for (let v = 0; v < n; v++) {
    let total = 0
    fields.forEach((field, f) => {
      const p = input.frames[f].projection
      const inside = p[v * 2] > 0 && p[v * 2] < 1 && p[v * 2 + 1] > 0 && p[v * 2 + 1] < 1
      // A coherent frontal reference prevents six slightly different expressions
      // being stitched into the eyes/lips. Side views take over continuously.
      field[v] = inside ? (field[v] / Math.max(1, counts[v])) ** 2 * (f === front ? 48 : 1) : 0
      total += field[v]
    })
    if (total > 1e-12) fields.forEach(field => { field[v] /= total })
  }
  return fields
}

/** Estimate gains ONLY from untouched source photos, never from painted output. */
export function exposureGains(input: AtlasInput): number[][] {
  const front = Math.max(0, input.frames.findIndex(f => f.step === 'front'))
  const ref = input.images[front], rframe = input.frames[front]
  const mean = (im: AtlasPixels, x: number, y: number, c: number) => {
    let sum = 0
    const px = Math.round(x * (im.width - 1)), py = Math.round(y * (im.height - 1))
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (Math.max(0, Math.min(im.height - 1, py + dy)) * im.width + Math.max(0, Math.min(im.width - 1, px + dx))) * 4
      sum += linear[im.data[i + c]]
    }
    return sum / 9
  }
  return input.frames.map((frame, f) => {
    if (f === front) return [1, 1, 1]
    const ratios: number[][] = [[], [], []]
    for (let t = 0; t < input.triangles.length; t += 3) {
      if (frame.weights[t / 3] < .15 || rframe.weights[t / 3] < .15) continue
      const ids = input.triangles.slice(t, t + 3)
      const xy = (projection: number[], k: number) => ids.reduce((s, v) => s + projection[v * 2 + k], 0) / 3
      const x = xy(frame.projection, 0), y = xy(frame.projection, 1)
      const rx = xy(rframe.projection, 0), ry = xy(rframe.projection, 1)
      if ([x, y, rx, ry].some(v => v <= .01 || v >= .99)) continue
      for (let c = 0; c < 3; c++) {
        const a = mean(ref, rx, ry, c), b = mean(input.images[f], x, y, c)
        if (a > .025 && b > .025 && a < .8 && b < .8) ratios[c].push(a / b)
      }
    }
    return ratios.map(values => {
      if (values.length < 12) return 1
      values.sort((a, b) => a - b)
      return Math.max(.7, Math.min(1.43, values[Math.floor(values.length / 2)]))
    })
  })
}

export function blendAtlas(input: AtlasInput): Uint8ClampedArray {
  const { size, triangles, frames, images, uv } = input
  const fields = blendFields(input), out = new Uint8ClampedArray(size * size * 4)
  const observed = new Uint8Array(size * size), colour = input.colour !== false
  const gains = input.gains ?? frames.map(() => [1, 1, 1])
  for (let i = 0; i < out.length; i += 4) { out[i] = colour ? 25 : 0; out[i + 1] = colour ? 23 : 255; out[i + 2] = colour ? 26 : 0; out[i + 3] = 255 }
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = triangles.slice(t, t + 3)
    const x = ids.map(v => uv[v * 2] * size), y = ids.map(v => (1 - uv[v * 2 + 1]) * size)
    const det = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2])
    if (Math.abs(det) < 1e-8) continue
    const minX = Math.max(0, Math.floor(Math.min(...x))), maxX = Math.min(size - 1, Math.ceil(Math.max(...x)))
    const minY = Math.max(0, Math.floor(Math.min(...y))), maxY = Math.min(size - 1, Math.ceil(Math.max(...y)))
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const a = ((y[1] - y[2]) * (px + .5 - x[2]) + (x[2] - x[1]) * (py + .5 - y[2])) / det
      const b = ((y[2] - y[0]) * (px + .5 - x[2]) + (x[0] - x[2]) * (py + .5 - y[2])) / det
      const c = 1 - a - b
      if (Math.min(a, b, c) < -1e-6) continue
      let r = 0, g = 0, blue = 0, total = 0
      for (let f = 0; f < frames.length; f++) {
        const field = fields[f]
        const w = a * field[ids[0]] + b * field[ids[1]] + c * field[ids[2]]
        if (w < 1e-5) continue
        const p = frames[f].projection, im = images[f]
        const sx = (a * p[ids[0] * 2] + b * p[ids[1] * 2] + c * p[ids[2] * 2]) * im.width - .5
        const sy = (a * p[ids[0] * 2 + 1] + b * p[ids[1] * 2 + 1] + c * p[ids[2] * 2 + 1]) * im.height - .5
        if (sx < 0 || sy < 0 || sx >= im.width - 1 || sy >= im.height - 1) continue
        const ix = Math.floor(sx), iy = Math.floor(sy), dx = sx - ix, dy = sy - iy
        const i = (iy * im.width + ix) * 4
        const sample = (channel: number) => {
          const value = (j: number) => colour ? linear[im.data[j + channel]] : im.data[j + channel] / 255
          return (value(i) * (1 - dx) + value(i + 4) * dx) * (1 - dy) + (value(i + im.width * 4) * (1 - dx) + value(i + im.width * 4 + 4) * dx) * dy
        }
        r += sample(0) * w * gains[f][0]; g += sample(1) * w * gains[f][1]; blue += sample(2) * w * gains[f][2]
        total += w
      }
      if (total < 1e-8) continue
      const index = py * size + px, dst = index * 4
      out[dst] = colour ? encode(r / total) : 255 * r / total
      out[dst + 1] = colour ? encode(g / total) : 255 * g / total
      out[dst + 2] = colour ? encode(blue / total) : 255 * blue / total
      observed[index] = 1
    }
  }
  // Two texels of padding prevent the background leaking through UV boundaries.
  // Padding changes texture only; it never creates unseen geometry.
  for (let pass = 0; pass < 2; pass++) {
    const pending: [number, number][] = []
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      if (observed[i]) continue
      const n = [i - 1, i + 1, i - size, i + size].find(j => observed[j])
      if (n !== undefined) pending.push([i, n])
    }
    for (const [i, n] of pending) { out.set(out.subarray(n * 4, n * 4 + 4), i * 4); observed[i] = 1 }
  }
  return out
}
