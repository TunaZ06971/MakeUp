import { useCallback, useEffect, useState } from 'react'
import { fetchProducts } from '../../lib/firestore/products'
import { readLocalDiagnostics, usesLocalServices } from '../../lib/localDiagnostics'
import type { MakeupCategory, Product } from '../../types/models'

interface Loaded {
  category: MakeupCategory | undefined
  attempt: number
  products: Product[]
  error: 'service-unavailable' | 'timeout' | 'permission-denied' | 'request-failed' | null
}

export function useProducts(category?: MakeupCategory) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const fail = (error: NonNullable<Loaded['error']>) => {
      if (!cancelled) setLoaded({ category, attempt, products: [], error })
      cancelled = true
    }
    // Firestore retries offline requests internally. Give the user a bounded wait
    // and a real retry action instead of leaving the catalog loading indefinitely.
    const timeout = window.setTimeout(() => fail('timeout'), 12000)

    const load = async () => {
      if (usesLocalServices) {
        const diagnostics = await readLocalDiagnostics(controller.signal)
        if (cancelled) return []
        if (diagnostics && !diagnostics.services.firestore) {
          fail('service-unavailable')
          return []
        }
      }
      return fetchProducts(category)
    }
    load()
      .then((products) => {
        if (!cancelled) setLoaded({ category, attempt, products, error: null })
      })
      .catch((error) => {
        console.error('Failed to load products', error)
        fail(error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied'
          ? 'permission-denied' : 'request-failed')
      })
      .finally(() => window.clearTimeout(timeout))

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [category, attempt])

  // Derived rather than stored, so switching category shows the loading state
  // without a second render pass.
  const fresh = loaded && loaded.category === category && loaded.attempt === attempt ? loaded : null
  return {
    products: fresh?.products ?? [],
    loading: fresh === null,
    error: Boolean(fresh?.error),
    errorKind: fresh?.error ?? null,
    retry,
  }
}
