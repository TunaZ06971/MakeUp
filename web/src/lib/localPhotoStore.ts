import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/// Face photos never leave the device, so they live in IndexedDB rather than
/// Firebase Storage. Records are namespaced by uid because a browser profile
/// can be shared by several accounts.
export interface FacePhotoRecord {
  id: string
  ownerUid: string
  blob: Blob
  thumbnail: Blob
  width: number
  height: number
  createdAt: number
}

interface MakeUpDB extends DBSchema {
  facePhotos: {
    key: string
    value: FacePhotoRecord
    indexes: { ownerUid: string }
  }
}

const THUMBNAIL_MAX_EDGE = 320

let dbPromise: Promise<IDBPDatabase<MakeUpDB>> | null = null

function getDB() {
  dbPromise ??= openDB<MakeUpDB>('makeup', 1, {
    upgrade(db) {
      const store = db.createObjectStore('facePhotos', { keyPath: 'id' })
      store.createIndex('ownerUid', 'ownerUid')
    },
  })
  return dbPromise
}

/** Decodes with EXIF orientation applied, so landmarks line up with what the user sees. */
export async function decodeImage(source: Blob) {
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' }) }
  catch (error) {
    // HEIC decoding is a lazy local WASM dependency; no photo is sent to a service.
    const header = new Uint8Array(await source.slice(0, 48).arrayBuffer())
    const signature = new TextDecoder('ascii').decode(header)
    if (!signature.includes('ftyp') || !/heic|heix|hevc|hevx|mif1|msf1/.test(signature)) throw error
    const { heicTo } = await import('heic-to/csp')
    bitmap = await heicTo({ blob: source, type: 'bitmap' })
  }
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height))
  if (scale === 1) return bitmap
  try { return await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * scale), resizeHeight: Math.round(bitmap.height * scale), resizeQuality: 'high' }) }
  finally { bitmap.close() }
}

async function renderThumbnail(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  )
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}

export async function saveFacePhoto(file: Blob, ownerUid: string): Promise<FacePhotoRecord> {
  const bitmap = await decodeImage(file)
  try {
    const record: FacePhotoRecord = {
      id: crypto.randomUUID(),
      ownerUid,
      blob: file,
      thumbnail: await renderThumbnail(bitmap),
      width: bitmap.width,
      height: bitmap.height,
      createdAt: Date.now(),
    }
    await (await getDB()).put('facePhotos', record)
    return record
  } finally {
    bitmap.close()
  }
}

/** Oldest first, so the order matches the order the views were imported. */
export async function listFacePhotos(ownerUid: string): Promise<FacePhotoRecord[]> {
  const records = await (await getDB()).getAllFromIndex('facePhotos', 'ownerUid', ownerUid)
  return records.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getFacePhoto(id: string) {
  return (await getDB()).get('facePhotos', id)
}

export async function deleteFacePhoto(id: string) {
  await (await getDB()).delete('facePhotos', id)
}
