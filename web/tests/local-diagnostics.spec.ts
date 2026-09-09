import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { build, preview } from 'vite'
import { sourceDigest, isLocalRequest, localDiagnosticsPlugin } from '../scripts/local-diagnostics'

test('source fingerprint includes uncommitted contents but excludes secrets and private photos', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'makeup-version-'))
  try {
    mkdirSync(resolve(root, 'src'))
    writeFileSync(resolve(root, 'src/main.ts'), 'export const value = 1')
    const first = sourceDigest(root)
    writeFileSync(resolve(root, '.env'), 'SECRET=do-not-read')
    mkdirSync(resolve(root, 'public/dev'), { recursive: true })
    writeFileSync(resolve(root, 'public/dev/private.jpg'), 'private image')
    expect(sourceDigest(root)).toBe(first)
    writeFileSync(resolve(root, 'src/main.ts'), 'export const value = 2')
    expect(sourceDigest(root)).not.toBe(first)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('diagnostics reject LAN and cross-origin requests and cannot proxy arbitrary URLs', async ({ request }) => {
  const local = { headers: { host: '127.0.0.1:5173' }, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage
  expect(isLocalRequest(local)).toBe(true)
  expect(isLocalRequest({ ...local, socket: { remoteAddress: '192.168.1.3' } } as IncomingMessage)).toBe(false)
  expect(isLocalRequest({ ...local, headers: { ...local.headers, origin: 'https://example.com' } })).toBe(false)
  const status = await request.get('/__makeup/local-status')
  expect(status.ok()).toBe(true)
  const data = await status.json()
  expect(data.sourceHash).toMatch(/^[a-f0-9]{12}$/)
  expect(data.services).toEqual({ auth: true, firestore: true })
  expect(status.headers()['cache-control']).toBe('no-store')
  expect((await request.get('/__makeup/local-status?url=https://example.com')).status()).toBe(400)
  expect((await request.post('/__makeup/local-status')).status()).toBe(400)
  expect((await request.get('/__makeup/local-status', { headers: { Origin: 'https://example.com' } })).status()).toBe(403)
})

test('production embeds a fixed source version and local preview identifies newer source', async ({ request }) => {
  const root = mkdtempSync(resolve(tmpdir(), 'makeup-build-'))
  let server: Awaited<ReturnType<typeof preview>> | undefined
  try {
    mkdirSync(resolve(root, 'src'))
    writeFileSync(resolve(root, 'index.html'), '<script type="module" src="/src/main.js"></script>')
    writeFileSync(resolve(root, 'src/main.js'), 'import info from "virtual:makeup-build-info"; document.body.textContent = info.sourceHash')
    const hash = sourceDigest(root)
    await build({ root, configFile: false, plugins: [localDiagnosticsPlugin()], logLevel: 'silent' })
    server = await preview({ root, configFile: false, plugins: [localDiagnosticsPlugin()], logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Preview has no TCP port')
    const url = `http://127.0.0.1:${address.port}`
    const built = await (await request.get(`${url}/build-info.json`)).json()
    expect(built.sourceHash).toBe(hash)
    expect(built.mode).toBe('production')
    expect(Number.isFinite(Date.parse(built.createdAt))).toBe(true)
    writeFileSync(resolve(root, 'src/main.js'), '// newer, unbuilt source')
    const current = await (await request.get(`${url}/__makeup/local-status`)).json()
    expect(current.mode).toBe('preview')
    expect(current.sourceHash).not.toBe(hash)
    expect((await (await request.get(`${url}/build-info.json`)).json()).sourceHash).toBe(hash)
  } finally {
    if (server) await new Promise<void>((resolveClose, reject) => server!.httpServer.close(error => error ? reject(error) : resolveClose()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('a changed source cannot silently relabel the already-loaded page as current', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('makeup.language', 'en'))
  await page.goto('/tests/diagnostics-harness.html')
  await page.locator('summary').click()
  await expect(page.getByText('Sign-in service: reachable', { exact: false })).toBeVisible()
  const initialVersion = await page.evaluate(() => (window as unknown as { loadedBuildInfo: { sourceHash: string } }).loadedBuildInfo.sourceHash)
  await page.route('**/__makeup/local-status', route => route.fulfill({ json: {
    mode: 'development', sourceHash: 'abcdef123456', checkedAt: new Date().toISOString(), services: { auth: true, firestore: true },
  } }))
  await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByText('Source changed after this page loaded.', { exact: false })).toBeVisible()
  await expect(page.locator('summary')).toContainText(initialVersion)
  await expect(page.locator('summary')).not.toContainText('abcdef123456')
})

test('catalog shows unavailable service and retries a real authenticated product query', async ({ page, request }) => {
  const email = `diagnostics-${randomUUID()}@example.test`
  const password = 'LocalRetry2026!'
  const accountResponse = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { data: { email, password, returnSecureToken: true } })
  expect(accountResponse.ok()).toBe(true)
  const account = await accountResponse.json()
  let reachable = false
  try {
    await page.addInitScript(() => localStorage.setItem('makeup.language', 'en'))
    await page.route('**/__makeup/local-status', route => route.fulfill({ json: {
      mode: 'development', sourceHash: 'abcdef123456', checkedAt: new Date().toISOString(), services: { auth: true, firestore: reachable },
    } }))
    await page.goto('/tests/diagnostics-harness.html')
    await page.getByRole('button', { name: 'Show catalog' }).click()
    await expect(page.getByRole('alert')).toContainText('The local product catalog service is unreachable')
    reachable = true
    await page.getByRole('button', { name: 'Retry loading products' }).click()
    // A real Firestore permission error is also recoverable without a page reload.
    await expect(page.getByRole('alert')).toContainText('Product access was denied')
    await page.evaluate(async ({ email, password }) => {
      await (window as unknown as { signInForTest: (email: string, password: string) => Promise<unknown> }).signInForTest(email, password)
    }, { email, password })
    await page.getByRole('button', { name: 'Retry loading products' }).click()
    await expect(page.getByRole('button', { name: /Dior 999/ })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key', { data: { idToken: account.idToken } })
  }
})
