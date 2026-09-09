import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useState, type ReactNode } from 'react'
import { auth } from '../../lib/firebase'
import { AuthContext, type AuthState } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, ready: false })

  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, ready: true })), [])

  return <AuthContext value={state}>{children}</AuthContext>
}
