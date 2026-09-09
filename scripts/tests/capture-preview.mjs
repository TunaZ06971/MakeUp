// Verify the bundled capture route with simulated media; never open a physical camera.
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../../web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const root = fileURLToPath(new URL('../../', import.meta.url))
const words = JSON.parse(readFileSync(`${root}/web/src/i18n/locales/zh.json`, 'utf8')).capture
const photo = `data:image/jpeg;base64,${readFileSync(`${root}/web/public/dev/face2.jpg`).toString('base64')}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const external = [], errors = []
  page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url()) })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(photo => {
    localStorage.setItem('makeup.language', 'zh')
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image(); image.src = photo; await image.decode()
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720
      const ctx = c.getContext('2d'), scale = Math.min(1280 / image.width, 720 / image.height)
      const draw = () => { ctx.fillStyle = '#383838'; ctx.fillRect(0, 0, 1280, 720); ctx.drawImage(image, (1280 - image.width * scale) / 2, 0, image.width * scale, image.height * scale) }
      draw(); const stream = c.captureStream(15), timer = setInterval(draw, 66)
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track)
      track.stop = () => { clearInterval(timer); stop() }
      window.previewCamera = stream
      return stream
    }
  }, photo)
  await page.goto('http://127.0.0.1:5174/capture')
  await page.getByRole('button', { name: words.start, exact: true }).click()
  await expect.poll(() => page.locator('.capture-live .observed').count(), { timeout: 25000 }).toBeGreaterThan(0)
  mkdirSync(`${root}/.artifacts/head-capture`, { recursive: true })
  await page.screenshot({ path: `${root}/.artifacts/head-capture/preview-recording-zh.png`, fullPage: true })
  await page.getByRole('button', { name: words.finish, exact: true }).click()
  await expect(page.locator('.capture-review')).toBeVisible()
  await expect.poll(() => page.locator('.capture-clips video').evaluate(v => v.readyState)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.previewCamera.getTracks().every(t => t.readyState === 'ended'))).toBe(true)
  await page.reload(); await expect(page.locator('.capture-review')).toBeVisible()
  const version = await page.locator('.local-status summary code').textContent()
  const built = JSON.parse(readFileSync(`${root}/web/dist/build-info.json`, 'utf8'))
  expect(version).toBe(built.sourceHash)
  expect(errors).toEqual([]); expect(external).toEqual([])
  console.log(JSON.stringify({ result: 'passed', sourceHash: version, realBundledWorker: true, realMediaRecorder: true, simulatedCamera: true, noExternalRequests: true }))
} finally { await browser.close() }
