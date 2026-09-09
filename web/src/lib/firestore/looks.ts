import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { ApplicableRegion } from '../../types/models'
import type { Stroke } from '../../features/render-engine/paintLayer'

/**
 * A saved look is a recipe, never a picture.
 *
 * Region applications and brush strokes are both recorded against the shared
 * face topology, so a look reproduces on any photo, any angle, and any device —
 * and nothing here identifies the face it was made on, which is what allows it
 * to sync while the photos stay local.
 */
export interface SavedApplication {
  productId: string
  colorIndex: number
  region: ApplicableRegion
  intensity: number
}

export interface SavedPaint {
  productId: string
  colorIndex: number
  intensity: number
  strokes: Stroke[]
}

export interface Look {
  id: string
  ownerUid: string
  title: string
  applied: SavedApplication[]
  painted: SavedPaint[]
  createdAt?: unknown
  updatedAt?: unknown
}

export type LookDraft = Omit<Look, 'id' | 'createdAt' | 'updatedAt'>

export async function listLooks(ownerUid: string): Promise<Look[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'looks'),
      where('ownerUid', '==', ownerUid),
      orderBy('updatedAt', 'desc'),
    ),
  )
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Look)
}

export async function createLook(draft: LookDraft): Promise<string> {
  const created = await addDoc(collection(db, 'looks'), {
    ...draft,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return created.id
}

export async function updateLook(id: string, draft: LookDraft): Promise<void> {
  await updateDoc(doc(db, 'looks', id), { ...draft, updatedAt: serverTimestamp() })
}

export async function deleteLook(id: string): Promise<void> {
  await deleteDoc(doc(db, 'looks', id))
}
