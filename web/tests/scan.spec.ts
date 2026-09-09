import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  ScanProtocol,
  type Observation,
} from '../src/features/face-scan/scanProtocol'
const good: Observation = {
  time: 0,
  faceCount: 1,
  yaw: 0,
  pitch: 0,
  roll: 0,
  blink: 0,
  mouth: 0,
  faceSize: 0.5,
  centered: true,
  brightness: 0.5,
  sharpness: 100,
  tracking: true,
}
test('capture requires all angles, expression then relaxation, with uninterrupted quality', () => {
  const p = new ScanProtocol()
  let time = 0
  const accepted: string[] = [],
    expressions: string[] = []
  const hold = (overrides: Partial<Observation>, count = 9) => {
    for (let i = 0; i < count; i++) {
      time += 100
      const r = p.update({ ...good, ...overrides, time })
      if (r.accepted) accepted.push(r.accepted)
      if (r.captureExpression) expressions.push(r.captureExpression)
    }
  }
  hold({})
  expect(p.step).toBe('left')
  hold({}, 20)
  expect(p.step).toBe('left')
  hold({ yaw: 0.5 }, 4)
  hold({ yaw: 0.5, faceCount: 2 })
  hold({ yaw: 0.5 }, 4)
  expect(p.step).toBe('left')
  hold({ yaw: 0.5 })
  hold({ yaw: -0.5 })
  hold({ pitch: 0.3 })
  hold({ pitch: -0.3 })
  expect(p.step).toBe('blink')
  hold({ blink: 0.8 })
  expect(p.step).toBe('blink')
  hold({})
  expect(p.step).toBe('mouth')
  hold({ mouth: 0.8 })
  expect(p.step).toBe('mouth')
  hold({})
  hold({})
  expect(p.complete).toBe(true)
  expect(accepted).toEqual([
    'front',
    'left',
    'right',
    'up',
    'down',
    'blink',
    'mouth',
    'finish',
  ])
  expect(expressions).toEqual(['blink', 'mouth'])
})
test('tracking loss and timing gaps reset a hold', () => {
  const p = new ScanProtocol()
  for (const time of [100, 200, 300, 400, 500]) p.update({ ...good, time })
  p.update({ ...good, time: 2000 })
  expect(p.index).toBe(0)
  expect(p.progress).toBe(0)
  p.update({ ...good, time: 2100, tracking: false })
  expect(p.progress).toBe(0)
  for (const [field, value, issue] of [
    ['brightness', 0, 'dark'],
    ['sharpness', 1, 'blur'],
    ['faceSize', 0.1, 'closer'],
    ['roll', 0.5, 'level'],
  ] as const)
    expect(p.update({ ...good, time: 2200, [field]: value }).issue).toBe(issue)
})
test('unmet poses and expressions never ask the user to hold an invalid position', () => {
  const p = new ScanProtocol('left')
  let time = 0
  const observe = (overrides: Partial<Observation> = {}) => p.update({ ...good, ...overrides, time: time += 100 })
  expect(observe({ yaw: .5 }).issue).toBe('adjustPose')
  for (let i = 0; i < 9; i++) observe()
  expect(p.step).toBe('left')
  expect(observe().issue).toBe('adjustPose')
  expect(p.progress).toBe(0)
  for (let i = 0; i < 9; i++) observe({ yaw: .5 })
  expect(p.step).toBe('leftProfile')
  expect(observe({ yaw: Math.PI / 2 }).issue).toBe('adjustPose')
  expect(p.skipProfile()).toBe(true)
  for (let i = 0; i < 9; i++) observe({ pitch: .3 })
  for (let i = 0; i < 9; i++) observe({ pitch: -.3 })
  expect(p.step).toBe('blink')
  expect(observe().issue).toBe('performAction')
  expect(p.progress).toBe(0)
  expect(p.skippedSteps).toEqual(['leftProfile'])
})
test('texture orientation and real-photo 3D fixture', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/tests/scan-harness.html')
  await page.waitForFunction(
    () => typeof (window as any).createScanFixture === 'function',
  )
  expect(await page.evaluate(() => (window as any).atlasTest())).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
  ])
  const { scan, ...metrics } = await page.evaluate(() =>
    (window as any).createScanFixture(),
  )
  mkdirSync('../.artifacts/scan', { recursive: true })
  writeFileSync(
    '../.artifacts/scan/renderer-fixture.makeupscan',
    JSON.stringify(scan),
  )
  writeFileSync(
    '../.artifacts/scan/texture.png',
    Buffer.from(scan.texture.split(',')[1], 'base64'),
  )
  writeFileSync(
    '../.artifacts/scan/metrics.json',
    JSON.stringify(metrics, null, 2),
  )
  expect(scan.vertices.length).toBe(468 * 3)
  const z = scan.vertices.filter((_: number, i: number) => i % 3 === 2)
  expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(0.2)
})

test('capture worker loads locally and detects the face off the UI thread', async ({
  page,
}) => {
  test.setTimeout(120000)
  const external: string[] = []
  page.on('request', (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith('http://127.0.0.1:5173')
    )
      external.push(r.url())
  })
  await page.goto('/tests/scan-harness.html')
  await page.waitForFunction(
    () => typeof (window as any).runScanWorker === 'function',
  )
  expect(await page.evaluate(() => (window as any).runScanWorker())).toEqual({
    count: 1,
    points: 478,
    matrix: 16,
  })
  expect(external).toEqual([])
})
