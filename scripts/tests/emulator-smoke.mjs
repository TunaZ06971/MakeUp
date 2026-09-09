import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// Only use fresh local emulators. This check must never fall through to a cloud account.
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  assert.match(process.env[name] ?? '', /^(127\.0\.0\.1|localhost):\d+$/, `${name} must identify a local emulator`)
}
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined)
const seeded = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed/seedProducts.ts'], {
  stdio: 'inherit', env: { ...process.env, FIREBASE_PROJECT_ID: 'demo-makeup' },
})
assert.equal(seeded.status, 0, 'Product seed must succeed with the installed Admin SDK')
const app = initializeApp({ projectId: 'demo-makeup' })
const auth = getAuth(app), db = getFirestore(app)
let uid
try {
  const user = await auth.createUser({ email: `smoke-${randomUUID()}@example.test`, password: 'LocalEmulatorOnly2026!' })
  uid = user.uid
  assert.equal((await auth.getUser(uid)).emailVerified, false)
  const products = await db.collection('products').limit(1).get()
  assert.equal(products.size, 1)
  console.log('Local emulator smoke passed: Admin SDK account round trip and product seed/read.')
} finally {
  if (uid) await auth.deleteUser(uid)
  await db.terminate()
  await deleteApp(app)
}
