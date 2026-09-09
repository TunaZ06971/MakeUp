import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { auth } from '../../lib/firebase'
import { ensureUserProfile } from '../../lib/firestore/users'
import type { AppLanguage } from '../../types/models'

export async function signUp(
  email: string,
  password: string,
  displayName: string,
  language: AppLanguage,
) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password)
  if (displayName) await updateProfile(user, { displayName })
  await ensureUserProfile(user, language)
}

export async function signIn(email: string, password: string, language: AppLanguage) {
  const { user } = await signInWithEmailAndPassword(auth, email, password)
  await ensureUserProfile(user, language)
}

export function signOutUser() {
  return signOut(auth)
}

export function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email)
}

const ERROR_KEYS: Record<string, string> = {
  'auth/invalid-email': 'auth.error.invalidEmail',
  'auth/missing-password': 'auth.error.missingPassword',
  'auth/weak-password': 'auth.error.weakPassword',
  'auth/email-already-in-use': 'auth.error.emailInUse',
  'auth/invalid-credential': 'auth.error.invalidCredential',
  'auth/user-not-found': 'auth.error.invalidCredential',
  'auth/wrong-password': 'auth.error.invalidCredential',
  'auth/too-many-requests': 'auth.error.tooManyRequests',
  'auth/network-request-failed': 'auth.error.network',
}

export function authErrorKey(error: unknown): string {
  if (error instanceof FirebaseError) return ERROR_KEYS[error.code] ?? 'auth.error.generic'
  return 'auth.error.generic'
}
