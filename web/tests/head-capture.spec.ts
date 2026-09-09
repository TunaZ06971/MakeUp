import { test, expect, type Page } from '@playwright/test'
import { zipSync, strToU8, unzipSync } from 'fflate'
import { mkdirSync, readFileSync } from 'node:fs'
import { assessFrame, selectFrames, type Measurement, type RankedFrame } from '../src/features/head-capture/selection'
import { exportCapture, importCapture } from '../src/features/head-capture/captureArchive'
import { validateCapture, type HeadCapture } from '../src/features/head-capture/captureStore'

const good: Measurement = { timeMs: 1000, faceCount: 1, yaw: 0, pitch: 0, roll: 0, blink: 0, mouth: 0, brightness: .5, sharpness: 50, faceSize: .5, framed: true }
test('coverage uses observed views, ignores tracking failure and keeps temporally distinct best frames', () => {
  expect(assessFrame(good).view).toBe('front')
  expect(assessFrame({ ...good, yaw: .65 }).view).toBe('leftSide')
  expect(assessFrame({ ...good, yaw: -.65 }).view).toBe('rightSide')
  expect(assessFrame({ ...good, faceCount: 0 }).issue).toBe('noFace')
  expect(assessFrame({ ...good, faceCount: 2 }).issue).toBe('oneFace')
  expect(assessFrame({ ...good, mouth: .7 }).issue).toBe('expression')
  expect(assessFrame({ ...good, sharpness: 0 }).issue).toBe('blur')
  let frames: RankedFrame[] = []
  for (const [id, timeMs, score] of [['a', 0, .5], ['b', 100, .7], ['c', 900, .6], ['d', 1800, .4]] as const) frames = selectFrames(frames, { id, timeMs, score, view: 'front' })
  expect(frames.map(f => f.id)).toEqual(['b', 'c'])
  expect(frames.some(f => f.view !== 'front')).toBe(false)
  const result = selectFrames(frames, { id: 'e', timeMs: 2500, score: .9, view: 'left' })
  expect(result).toHaveLength(3)
  expect(result.slice(0, 2)).toEqual(frames)
})
const fixture = (): HeadCapture => ({
  schemaVersion: 1, kind: 'makeup-head-capture', protocol: 'continuous-rgb-v1', id: 'capture', createdAt: '2026-09-08', updatedAt: '2026-09-08', intendedSide: 'left', reconstruction: 'not-run',
  segments: [{ id: 'clip', createdAt: '2026-09-08', durationMs: 2000, width: 1920, height: 1080, video: new Blob(['video-bytes'], { type: 'video/webm' }), analyzedFrames: 10, rejected: { blur: 2 }, ended: 'user', frames: [{ id: 'frame', segmentId: 'clip', timeMs: 1000, view: 'front', score: .9, yaw: 0, pitch: 0, roll: 0, landmarks: Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 })), image: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }) }] }],
})
test('portable package preserves media bytes and rejects paths, missing media and invalid reconstruction claims', async () => {
  const archive = await exportCapture(fixture()), imported = await importCapture(archive)
  expect(await imported.segments[0].video.text()).toBe('video-bytes')
  expect(await imported.segments[0].frames[0].image.text()).toBe('jpeg-bytes')
  expect(imported.reconstruction).toBe('not-run')
  const data = unzipSync(new Uint8Array(await archive.arrayBuffer()))
  delete data['segments/clip.webm']
  await expect(importCapture(new Blob([zipSync(data).slice().buffer]))).rejects.toThrow('Missing')
  await expect(importCapture(new Blob([zipSync({ '../escape': strToU8('bad') }).slice().buffer]))).rejects.toThrow('Invalid archive entry')
  expect(() => validateCapture({ ...fixture(), reconstruction: 'complete' })).toThrow('Invalid capture')
  const invalid = fixture(); invalid.segments[0].frames[0].landmarks[2].x = NaN
  expect(() => validateCapture(invalid)).toThrow('Invalid keyframe')
})

async function camera(page: Page, brokenDetector = false) {
  if (brokenDetector) await page.route('**/mediapipe/face_landmarker.task', route => route.abort())
  await page.addInitScript(() => {
    localStorage.setItem('makeup.language', 'en')
    ;(window as any).cameraCalls = 0
    navigator.mediaDevices.getUserMedia = async () => {
      ;(window as any).cameraCalls++
      const bitmap = await createImageBitmap(await (await fetch('/dev/face2.jpg')).blob())
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
      const ctx = canvas.getContext('2d')!, scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
      let count = 0
      const draw = () => { ctx.fillStyle = '#383838'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, (canvas.width - bitmap.width * scale) / 2, 0, bitmap.width * scale, bitmap.height * scale); ctx.fillStyle = count++ % 2 ? '#383839' : '#38383a'; ctx.fillRect(0, 0, 2, 2) }
      draw()
      const stream = canvas.captureStream(15), timer = setInterval(draw, 66)
      const track = stream.getVideoTracks()[0], original = track.stop.bind(track)
      track.stop = () => { clearInterval(timer); bitmap.close(); original() }
      ;(window as any).testCameraStream = stream
      return stream
    }
  })
}
async function saved(page: Page) { await expect(page.locator('.capture-review')).toBeVisible({ timeout: 15000 }); await expect(page.locator('.capture-live')).toHaveCount(0) }

test('public capture records real media, survives reload, exports/reimports and appends without erasing', async ({ page }) => {
  test.setTimeout(100000)
  await camera(page)
  const remote: string[] = []
  page.on('request', r => { if (/^https?:/.test(r.url()) && !['127.0.0.1', 'localhost'].includes(new URL(r.url()).hostname)) remote.push(r.url()) })
  await page.goto('/capture')
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled()
  mkdirSync('../.artifacts/head-capture', { recursive: true })
  await page.screenshot({ path: '../.artifacts/head-capture/desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect.poll(() => page.locator('.capture-live .observed').count(), { timeout: 25000 }).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.capture-instruction progress').getAttribute('value')).not.toBe('0')
  expect(await page.evaluate(() => (window as any).cameraCalls)).toBe(1) // React StrictMode must not request twice.
  await page.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await saved(page)
  expect(await page.evaluate(() => (window as any).testCameraStream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  await expect(page.locator('.capture-model-status')).toContainText('not connected')
  await expect(page.locator('.capture-clips video')).toHaveCount(1)
  await expect.poll(() => page.locator('.capture-clips video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  await page.reload(); await saved(page)
  await expect(page.locator('.capture-clips video')).toHaveCount(1)
  await page.getByRole('button', { name: 'Record another clip', exact: true }).click()
  await expect.poll(() => page.locator('.capture-instruction progress').getAttribute('value')).toMatch(/^[1-9]\d{3,}/)
  await page.getByRole('button', { name: 'Finish and save', exact: true }).click(); await saved(page)
  await expect(page.locator('.capture-clips video')).toHaveCount(2)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export capture package', exact: true }).click()
  const download = await pending, path = await download.path()
  expect(download.suggestedFilename()).toBe('MakeUp-head.makeupcapture')
  const imported = await importCapture(new Blob([readFileSync(path!)]))
  expect(imported.segments).toHaveLength(2)
  expect(imported.segments.every(s => s.video.size > 1000 && s.durationMs > 500)).toBe(true)
  expect(imported.segments[0].frames.length).toBeGreaterThan(0)
  expect(imported.segments[0].width).toBe(1280)
  await page.getByRole('button', { name: 'Clear this capture', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm clear', exact: true }).click()
  await expect(page.locator('.capture-review')).toHaveCount(0)
  await page.getByLabel('Import capture package', { exact: true }).setInputFiles(path!)
  await saved(page)
  await expect(page.locator('.capture-clips video')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '../.artifacts/head-capture/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(remote).toEqual([])
})

test('optional face analysis failure still saves playable video and background stop preserves the clip', async ({ page }) => {
  test.setTimeout(40000)
  await camera(page, true)
  await page.goto('/capture'); await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.locator('.capture-instruction')).toContainText('video is still recording', { timeout: 15000 })
  await expect.poll(() => page.locator('.capture-instruction progress').getAttribute('value')).toMatch(/^[1-9]\d{3,}/)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await saved(page)
  await expect(page.locator('.capture-review')).toContainText('background')
  await expect(page.locator('.capture-review .observed')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).testCameraStream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  await expect.poll(() => page.locator('.capture-clips video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
})

test('denied permission returns an actionable error and delayed permission after cancel stops all tracks', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('makeup.language', 'en')
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') }
  })
  await page.goto('/capture'); await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('permission')
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { (window as any).allowCamera = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100
      const stream = canvas.captureStream(10); (window as any).lateStream = stream; resolve(stream)
    } })
  })
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).allowCamera)).toBe('function')
  await page.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await expect(page.locator('.capture-live')).toHaveCount(0)
  await page.evaluate(() => (window as any).allowCamera())
  await expect.poll(() => page.evaluate(() => (window as any).lateStream.getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  await expect(page.locator('.capture-review')).toHaveCount(0)
})

test('archive rejects misleading stored-entry sizes before allocating expanded content', async () => {
  const zip = zipSync({ 'segments/a.webm': new Uint8Array(1024 * 1024) }, { level: 0 })
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let edited = false
  for (let i = zip.length - 46; i >= 0; i--) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 0, true); edited = true; break }
  expect(edited).toBe(true)
  await expect(importCapture(new Blob([zip.slice().buffer]))).rejects.toThrow('Invalid archive sizes')
})

test('a stale second tab cannot overwrite an existing capture by importing', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('makeup.language', 'en'))
  const other = await context.newPage()
  await other.addInitScript(() => localStorage.setItem('makeup.language', 'en'))
  await page.goto('/capture'); await other.goto('/capture')
  await expect(other.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled()
  const a = fixture(), b = fixture(); b.id = 'different-capture'
  const input = async (value: HeadCapture) => ({ name: 'test.makeupcapture', mimeType: 'application/zip', buffer: Buffer.from(await (await exportCapture(value)).arrayBuffer()) })
  await page.getByLabel('Import capture package', { exact: true }).setInputFiles(await input(a))
  await saved(page)
  await other.getByLabel('Import capture package', { exact: true }).setInputFiles(await input(b))
  await expect(other.getByRole('alert')).toContainText('Could not read the capture package')
  const value = await page.evaluate(async () => {
    const { loadCapture } = await import('/src/features/head-capture/captureStore.ts')
    return (await loadCapture('device-local'))?.id
  })
  expect(value).toBe(a.id)
  await other.close()
})

test('failed persistent save keeps raw video downloadable, protects leaving and permits retry', async ({ page }) => {
  test.setTimeout(40000)
  await camera(page, true)
  await page.goto('/capture')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as any).failNextSave = true
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'captures' && (window as any).failNextSave) { (window as any).failNextSave = false; throw new DOMException('Simulated storage exhausted', 'QuotaExceededError') }
      return original.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect.poll(() => page.locator('.capture-instruction progress').getAttribute('value')).toMatch(/^[1-9]\d{3,}/)
  await page.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download unsaved video' })).toBeVisible()
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })).toBe(true)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download unsaved video' }).click()
  expect((await downloading).suggestedFilename()).toMatch(/^MakeUp-unsaved\.(webm|mp4)$/)
  await page.getByRole('button', { name: 'Retry local save' }).click()
  await saved(page)
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })).toBe(false)
  await expect(page.getByRole('button', { name: 'Download unsaved video' })).toHaveCount(0)
})
