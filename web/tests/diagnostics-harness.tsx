import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { signInWithEmailAndPassword } from 'firebase/auth'
import '../src/i18n'
import { auth } from '../src/lib/firebase'
import { buildInfo } from '../src/lib/localDiagnostics'
import { LocalStatus } from '../src/components/LocalStatus'
import { CatalogPanel } from '../src/features/catalog/CatalogPanel'

export function Harness() {
  const [catalog, setCatalog] = useState(false)
  return <><LocalStatus /><button onClick={() => setCatalog(true)}>Show catalog</button>{catalog && <CatalogPanel />}</>
}
Object.assign(window, {
  loadedBuildInfo: buildInfo,
  signInForTest: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
})
createRoot(document.getElementById('root')!).render(<Harness />)
