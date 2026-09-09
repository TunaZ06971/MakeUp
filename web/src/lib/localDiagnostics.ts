import currentModuleBuild from 'virtual:makeup-build-info'

// Preserve the original document snapshot even if this module is hot-replaced.
// A full browser reload creates a fresh window and is the only way to relabel it.
const page = window as typeof window & {
  __makeupPageVersion?: { buildInfo: typeof currentModuleBuild; loadedAt: string }
}
const snapshot = page.__makeupPageVersion ??= {
  buildInfo: currentModuleBuild, loadedAt: new Date().toISOString(),
}
export const buildInfo = snapshot.buildInfo
export const pageLoadedAt = snapshot.loadedAt

export interface LocalDiagnostics {
  mode: 'development' | 'preview'
  sourceHash: string
  checkedAt: string
  services: { auth: boolean; firestore: boolean }
}

export function isLocalPage(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

export const usesLocalServices = !import.meta.env.VITE_FIREBASE_API_KEY

/** Returns null when this is not a local Vite server; never contacts a remote URL. */
export async function readLocalDiagnostics(signal?: AbortSignal): Promise<LocalDiagnostics | null> {
  if (!isLocalPage()) return null
  try {
    const response = await fetch('/__makeup/local-status', {
      cache: 'no-store', credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3500)]) : AbortSignal.timeout(3500),
    })
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) return null
    const data = await response.json()
    if (!['development', 'preview'].includes(data.mode) || !/^[a-f0-9]{12}$/.test(data.sourceHash) ||
      typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt)) ||
      typeof data.services?.auth !== 'boolean' || typeof data.services?.firestore !== 'boolean') return null
    return data as LocalDiagnostics
  } catch {
    return null
  }
}
