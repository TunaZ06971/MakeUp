import { test, expect } from '@playwright/test'
import { blendAtlas, exposureGains, type AtlasInput } from '../src/features/face-scan/atlasBlend'
import { ScanProtocol, type Observation } from '../src/features/face-scan/scanProtocol'

test('neighbouring triangles cannot choose abruptly different camera colours', () => {
  const image = (value: number) => ({ width: 32, height: 32, data: Uint8ClampedArray.from({ length: 4096 }, (_, i) => i % 4 === 3 ? 255 : value) })
  const projection = [.02, .02, .98, .02, .98, .98, .02, .98]
  const input: AtlasInput = { size: 128, uv: [.02, .98, .98, .98, .98, .02, .02, .02], triangles: [0, 1, 2, 0, 2, 3],
    frames: [{ step: 'front', projection, weights: [.51, .49] }, { step: 'left', projection, weights: [.49, .51] }], images: [image(100), image(160)] }
  const output = blendAtlas(input)
  const value = (x: number, y: number) => output[(y * 128 + x) * 4]
  // Samples cross the shared edge. The old per-face winner jumps by 60 here.
  expect(Math.abs(value(63, 65) - value(65, 63))).toBeLessThanOrEqual(2)
  expect(value(64, 64)).toBeGreaterThanOrEqual(100)
  expect(value(64, 64)).toBeLessThan(110)
  const unknown = blendAtlas({ ...input, frames: input.frames.map(f => ({ ...f, weights: [0, 0] })) })
  expect(Array.from(unknown.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 3))).toEqual([25, 23, 26])
})

test('exposure uses matching observations and material data bypasses colour conversion', () => {
  const image = (value: number) => ({ width: 32, height: 32, data: Uint8ClampedArray.from({ length: 4096 }, (_, i) => i % 4 === 3 ? 255 : value) })
  const projection = [.05, .05, .95, .05, .5, .95]
  const input: AtlasInput = { size: 64, uv: [.05, .95, .95, .95, .5, .05], triangles: Array.from({ length: 36 }, (_, i) => i % 3),
    frames: [{ step: 'front', projection, weights: Array(12).fill(1) }, { step: 'left', projection, weights: Array(12).fill(1) }], images: [image(100), image(110)] }
  const gains = exposureGains(input)
  expect(gains[0]).toEqual([1, 1, 1])
  expect(gains[1][0]).toBeGreaterThan(.7)
  expect(gains[1][0]).toBeLessThan(.9)
  const output = blendAtlas({ ...input, gains })
  expect(output[(24 * 64 + 32) * 4]).toBe(100)
  const data = blendAtlas({ ...input, colour: false, images: [image(128), image(128)] })
  expect(data[(24 * 64 + 32) * 4]).toBe(128)
})

test('one-sided capture requires its observed profile and never the opposite side', () => {
  const o: Observation = { time: 0, faceCount: 1, tracking: true, centered: true, yaw: 0, pitch: 0, roll: 0, blink: 0, mouth: 0, faceSize: .5, brightness: .5, sharpness: 100 }
  const guide = new ScanProtocol('right')
  let time = 0
  const hold = (yaw: number) => { for (let i = 0; i < 9; i++) guide.update({ ...o, time: time += 100, yaw }) }
  hold(0); hold(-.5)
  expect(guide.step).toBe('rightProfile')
  hold(1.1); expect(guide.step).toBe('rightProfile')
  hold(-1.6); expect(guide.step).toBe('rightProfile')
  hold(-1.05); expect(guide.step).toBe('up')
  expect(guide.steps).not.toContain('left')
  expect(guide.skipProfile()).toBe(false)
  const limited = new ScanProtocol('left')
  let t = 0
  for (const yaw of [0, .5]) for (let i = 0; i < 9; i++) limited.update({ ...o, time: t += 100, yaw })
  expect(limited.skipProfile()).toBe(true)
  expect(limited.step).toBe('up')
  expect(limited.skippedSteps).toEqual(['leftProfile'])
})
