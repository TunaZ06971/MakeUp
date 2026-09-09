// Imports scripts/seed/products.seed.json into Firestore.
//
//   npm run seed                      -> local emulator (project demo-makeup)
//   FIREBASE_PROJECT_ID=... \
//   GOOGLE_APPLICATION_CREDENTIALS=... npm run seed   -> a real project
//
// Idempotent: sourceId doubles as the document id, so re-running updates in
// place rather than creating duplicates.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const CATEGORIES = new Set([
  'lipstick', 'eyeshadow', 'blush', 'foundation', 'eyeliner', 'brow', 'highlighter',
])
const FINISHES = new Set(['matte', 'satin', 'shimmer', 'glitter', 'metallic', 'sheer', 'dewy'])
const REGIONS = new Set([
  'lips', 'eyelid', 'crease', 'eyelidLine', 'waterline', 'eyebrows',
  'cheeks', 'cheekbones', 'noseBridge', 'cupidsBow', 'faceFull',
])
const HEX = /^#[0-9A-Fa-f]{6}$/

interface SeedProduct {
  sourceId: string
  brand: string
  brandZh?: string
  shadeName: string
  shadeNameZh?: string
  category: string
  colors: { hex: string; label?: string }[]
  finish: string
  opacity?: number
  applicableRegions: string[]
  textureAsset?: string
}

/** Fails loudly at seed time — a bad category is far cheaper to catch here. */
function validate(products: SeedProduct[]) {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const [index, product] of products.entries()) {
    const where = product.sourceId || `#${index}`
    if (!product.sourceId) problems.push(`${where}: missing sourceId`)
    if (seen.has(product.sourceId)) problems.push(`${where}: duplicate sourceId`)
    seen.add(product.sourceId)

    if (!CATEGORIES.has(product.category)) problems.push(`${where}: unknown category "${product.category}"`)
    if (!FINISHES.has(product.finish)) problems.push(`${where}: unknown finish "${product.finish}"`)
    if (!product.colors?.length) problems.push(`${where}: needs at least one color`)

    for (const color of product.colors ?? []) {
      if (!HEX.test(color.hex)) problems.push(`${where}: bad hex "${color.hex}"`)
    }
    for (const region of product.applicableRegions ?? []) {
      if (!REGIONS.has(region)) problems.push(`${where}: unknown region "${region}"`)
    }
    if (!product.applicableRegions?.length) problems.push(`${where}: needs at least one region`)
    if (product.opacity !== undefined && (product.opacity < 0 || product.opacity > 1)) {
      problems.push(`${where}: opacity ${product.opacity} outside 0..1`)
    }
  }

  if (problems.length) {
    throw new Error(`Seed data is invalid:\n  ${problems.join('\n  ')}`)
  }
}

/** Lowercased tokens covering both languages, so search works either way. */
function searchKeywords(product: SeedProduct): string[] {
  const parts = [
    product.brand, product.brandZh, product.shadeName, product.shadeNameZh, product.category,
  ].filter((value): value is string => Boolean(value))

  const tokens = new Set<string>()
  for (const part of parts) {
    const lower = part.toLowerCase()
    tokens.add(lower)
    for (const word of lower.split(/[\s\-·]+/)) {
      if (word) tokens.add(word)
    }
  }
  return [...tokens]
}

const here = dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(await readFile(join(here, 'products.seed.json'), 'utf8'))
const products: SeedProduct[] = raw.products
validate(products)

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-makeup'
const useEmulator = !process.env.GOOGLE_APPLICATION_CREDENTIALS
if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
  initializeApp({ projectId })
} else {
  initializeApp({ credential: applicationDefault(), projectId })
}

const db = getFirestore()
const batch = db.batch()
const now = FieldValue.serverTimestamp()

for (const product of products) {
  batch.set(
    db.collection('products').doc(product.sourceId),
    {
      ...product,
      source: 'curated_v1',
      searchKeywords: searchKeywords(product),
      isActive: true,
      schemaVersion: raw.schemaVersion ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  )
}

await batch.commit()

const byCategory = new Map<string, number>()
for (const product of products) {
  byCategory.set(product.category, (byCategory.get(product.category) ?? 0) + 1)
}

console.log(
  `Seeded ${products.length} products into ${useEmulator ? `emulator (${projectId})` : projectId}:`,
)
for (const [category, count] of [...byCategory].sort()) {
  console.log(`  ${category.padEnd(12)} ${count}`)
}
