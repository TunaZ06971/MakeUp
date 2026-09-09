import type { User } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { AppLanguage } from '../../types/models'

export function userDoc(uid: string) {
  return doc(db, 'users', uid)
}

export async function ensureUserProfile(user: User, language: AppLanguage) {
  const ref = userDoc(user.uid)
  if ((await getDoc(ref)).exists()) return

  await setDoc(ref, {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? '',
    preferredLanguage: language,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}
