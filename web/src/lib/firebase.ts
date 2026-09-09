import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const env = import.meta.env

// Without real credentials we point at the Firebase Local Emulator Suite, which
// accepts any project id prefixed with "demo-" and needs no cloud project.
export const usingEmulator = !env.VITE_FIREBASE_API_KEY

const emulatorConfig: FirebaseOptions = {
  apiKey: 'demo-api-key',
  projectId: 'demo-makeup',
  appId: 'demo-app-id',
}

const cloudConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(usingEmulator ? emulatorConfig : cloudConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

if (usingEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
