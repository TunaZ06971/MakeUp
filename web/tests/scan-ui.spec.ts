import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// Produce the private fixture on a clean checkout too; do not depend on test file order.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  try {
    await page.goto('http://127.0.0.1:5173/tests/scan-harness.html')
    await page.waitForFunction(
      () => typeof (window as any).createScanFixture === 'function',
    )
    const { scan } = await page.evaluate(() =>
      (window as any).createScanFixture(),
    )
    mkdirSync('../.artifacts/scan', { recursive: true })
    writeFileSync(
      '../.artifacts/scan/renderer-fixture.makeupscan',
      JSON.stringify(scan),
    )
  } finally {
    await page.close()
  }
})

test('3D import, rotation, makeup, GLB export and local reload', async ({
  page,
  request,
}) => {
  test.setTimeout(120000)
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(m.text())
  })
  page.on('pageerror', (e) => console.log(e.message))
  const email = `scan-${randomUUID()}@example.test`,
    password = 'ScanLocal2026!'
  const account = await (
    await request.post(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key',
      { data: { email, password, returnSecureToken: true } },
    )
  ).json()
  try {
    await page.addInitScript(() =>
      localStorage.setItem('makeup.language', 'en'),
    )
    await page.goto(process.env.MAKEUP_TEST_ORIGIN ?? '/')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page
      .getByRole('button', { name: 'Legacy coarse face capture', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.screenshot({ path: '../.artifacts/scan/capture-intro.png' })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page
      .getByLabel('Import model file', { exact: true })
      .setInputFiles('../.artifacts/scan/renderer-fixture.makeupscan')
    const canvas = page.locator('.model-viewer canvas')
    await expect(canvas).toBeVisible()
    await expect(page.locator('.scan-workspace')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
    const image = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())
    writeFileSync(
      '../.artifacts/scan/debug.png',
      Buffer.from((await image()).split(',')[1], 'base64'),
    )
    await expect.poll(async () => (await image()).length).toBeGreaterThan(15000)
    const front = await image()
    await canvas.screenshot({ path: '../.artifacts/scan/front.png' })
    await page.getByRole('button', { name: 'Captured photo comparison', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Original captured photo', exact: true })).toBeVisible()
    await expect(page.getByText('These are captured photographs, not a full 3D head.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '3D surface', exact: true }).click()
    await expect(canvas).toBeVisible()
    await page.getByRole('button', { name: 'Left', exact: true }).click()
    await expect.poll(image).not.toBe(front)
    await canvas.screenshot({ path: '../.artifacts/scan/left.png' })
    await page.getByRole('button', { name: 'Front', exact: true }).click()
    await expect.poll(image).toBe(front)
    await page.getByRole('searchbox').fill('999')
    await page.getByRole('button', { name: /Dior 999/ }).click()
    await expect.poll(image, { timeout: 30000 }).not.toBe(front)
    await expect(page.locator('.scan-workspace')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 30000 },
    )
    await canvas.screenshot({ path: '../.artifacts/scan/makeup.png' })
    const exported = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export GLB', exact: true }).click()
    const download = await exported
    const path = '../.artifacts/scan/face.glb'
    await download.saveAs(path)
    expect(readFileSync(path).subarray(0, 4).toString()).toBe('glTF')
    const glb = readFileSync(path), jsonLength = glb.readUInt32LE(12)
    const exportedScene = JSON.parse(glb.subarray(20, 20 + jsonLength).toString())
    expect(exportedScene.materials[0].emissiveTexture).toBeDefined()
    expect(exportedScene.materials[0].extensions.KHR_materials_clearcoat.clearcoatTexture).toBeDefined()
    await page.reload()
    await expect(canvas).toBeVisible()
    await expect(page.locator('.scan-workspace')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
    await expect.poll(image).toBe(front)
    await page
      .getByRole('button', { name: 'Paint by hand', exact: true })
      .click()
    await page.getByRole('searchbox').fill('999')
    await page.getByRole('button', { name: /Dior 999/ }).click()
    await expect(page.locator('.scan-workspace')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 30000 },
    )
    const base = await image(),
      box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.49, box.y + box.height * 0.715)
    await page.mouse.down()
    let changedWhileDrawing = false
    for (let i = 0; i < 25; i++) {
      await page.mouse.move(box.x + box.width * (0.49 + 0.03 * (i / 24)), box.y + box.height * 0.715)
      // Keep delivering input: a debounced/cancelled bake must not starve the preview.
      await page.waitForTimeout(80)
      if (i < 24 && (await image()) !== base) changedWhileDrawing = true
    }
    expect(changedWhileDrawing).toBe(true)
    await expect.poll(image, { timeout: 30000 }).not.toBe(base)
    await page.mouse.up()
    await expect(
      page.getByRole('button', { name: 'Undo stroke', exact: true }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Undo stroke', exact: true }).click()
    await expect
      .poll(async () => (await image()) === base, { timeout: 30000 })
      .toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: '../.artifacts/scan/mobile.png',
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Delete local model', exact: true })
      .click()
    await expect(canvas).toHaveCount(0)
  } finally {
    await request.post(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key',
      { data: { idToken: account.idToken } },
    )
  }
})

test('camera sequence runs locally, a stationary face cannot finish, closing stops every track', async ({
  page,
  request,
}) => {
  test.setTimeout(120000)
  const email = `camera-${randomUUID()}@example.test`,
    password = 'ScanLocal2026!'
  const account = await (
    await request.post(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key',
      { data: { email, password, returnSecureToken: true } },
    )
  ).json()
  try {
    await page.addInitScript(
      (photo: string) => {
        localStorage.setItem('makeup.language', 'en')
        navigator.mediaDevices.getUserMedia = async () => {
          const bitmap = await createImageBitmap(
            await (await fetch(photo)).blob(),
          )
          const c = document.createElement('canvas')
          c.width = bitmap.width
          c.height = bitmap.height
          c.getContext('2d')!.drawImage(bitmap, 0, 0)
          bitmap.close()
          const stream = c.captureStream(10)
          ;(window as any).testCameraStream = stream
          return stream
        }
      },
      JSON.parse(
        readFileSync('../.artifacts/scan/renderer-fixture.makeupscan', 'utf8'),
      ).frames[0].image,
    )
    await page.goto(process.env.MAKEUP_TEST_ORIGIN ?? '/')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page
      .getByRole('button', { name: 'Legacy coarse face capture', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Enable camera and begin', exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: 'Slowly turn your head left',
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 })
    // Let multiple real worker detections observe the unchanged pose.
    await expect
      .poll(() => page.locator('.scan-instruction span').textContent())
      .toBe('2 / 8')
    await page.screenshot({ path: '../.artifacts/scan/camera-fixture.png' })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    expect(
      await page.evaluate(() =>
        (window as any).testCameraStream
          .getTracks()
          .every((t: MediaStreamTrack) => t.readyState === 'ended'),
      ),
    ).toBe(true)
    await expect(page.locator('.model-viewer canvas')).toHaveCount(0)
  } finally {
    await request.post(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key',
      { data: { idToken: account.idToken } },
    )
  }
})
