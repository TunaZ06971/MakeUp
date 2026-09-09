import type { User } from 'firebase/auth'
import { createContext, useContext } from 'react'

export interface AuthState {
  user: User | null
  ready: boolean
}

export const AuthContext = createContext<AuthState>({ user: null, ready: false })

export function useAuth() {
  return useContext(AuthContext)
}
