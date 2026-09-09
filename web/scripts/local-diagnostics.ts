import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ResolvedConfig } from 'vite'

const virtualId = 'virtual:makeup-build-info'
const resolvedId = `\0${virtualId}`
export const diagnosticPath = '/__makeup/local-status'

export interface BuildInfo {
  sourceHash: string
  createdAt: string
  mode: 'development' | 'production'
}

/** Hash file contents, including uncommitted code; never read .env or private photos. */
export function sourceDigest(root: string): string {
  const hash = createHash('sha256')
  const visit = (path: string) => {
    if (!existsSync(path)) return
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(resolve(path, name))
    } else {
      hash.update(relative(root, path).split(sep).join('/'))
      hash.update('\0')
      hash.update(readFileSync(path))
      hash.update('\0')
    }
  }
  for (const name of ['src', 'scripts', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.app.json', 'tsconfig.node.json']) {
    visit(resolve(root, name))
  }
  return hash.digest('hex').slice(0, 12)
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** The endpoint is for this machine, not LAN clients or a general HTTP proxy. */
export function isLocalRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  if (!loopbackAddresses.has(request.socket.remoteAddress ?? '')) return false
  try {
    const host = new URL(`http://${request.headers.host}`)
    if (!loopbackHosts.has(host.hostname)) return false
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers.origin
    if (origin && new URL(origin).host !== host.host) return false
    return true
  } catch {
    return false
  }
}

async function probeService(service: 'auth' | 'firestore'): Promise<boolean> {
  try {
    // Fixed, read-only readiness endpoints contain no accounts or face information.
    const response = await fetch(service === 'auth' ? 'http://127.0.0.1:9099/' : 'http://127.0.0.1:8080/', {
      signal: AbortSignal.timeout(1200), redirect: 'error',
    })
    if (!response.ok) return false
    if (service === 'auth') {
      const data = await response.json() as { authEmulator?: { ready?: boolean } }
      return data.authEmulator?.ready === true
    }
    return (await response.text()).trim() === 'Ok'
  } catch {
    return false
  }
}

export function localDiagnosticsPlugin(): Plugin {
  let config: ResolvedConfig
  let buildInfo: BuildInfo | undefined
  const snapshot = (): BuildInfo => ({
    sourceHash: sourceDigest(config.root), createdAt: new Date().toISOString(),
    mode: config.command === 'build' ? 'production' : 'development',
  })
  const middleware = (mode: 'development' | 'preview') => async (
    request: IncomingMessage, response: ServerResponse, next: () => void,
  ) => {
    if (request.url?.split('?')[0] !== diagnosticPath) return next()
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (!isLocalRequest(request)) {
      response.statusCode = 403
      response.end(JSON.stringify({ error: 'Local requests only' }))
      return
    }
    if (request.method !== 'GET' || request.url !== diagnosticPath) {
      response.statusCode = 400
      response.end(JSON.stringify({ error: 'Use the fixed GET endpoint without parameters' }))
      return
    }
    try {
      const [auth, firestore] = await Promise.all([probeService('auth'), probeService('firestore')])
      response.end(JSON.stringify({ mode, sourceHash: sourceDigest(config.root), checkedAt: new Date().toISOString(), services: { auth, firestore } }))
    } catch {
      response.statusCode = 503
      response.end(JSON.stringify({ error: 'Local diagnostics unavailable' }))
    }
  }
  return {
    name: 'makeup-local-diagnostics',
    configResolved(value) { config = value },
    resolveId(id) { if (id === virtualId) return resolvedId },
    load(id) {
      if (id !== resolvedId) return
      const info = config.command === 'build' ? (buildInfo ??= snapshot()) : snapshot()
      return `export default ${JSON.stringify(info)}`
    },
    configureServer(server) {
      server.middlewares.use(middleware('development'))
      // Invalidate for the next page reload, but do not HMR-relabel the running page
      // as a completely fresh version when only some modules have been replaced.
      const invalidate = () => {
        const module = server.moduleGraph.getModuleById(resolvedId)
        if (module) server.moduleGraph.invalidateModule(module)
      }
      server.watcher.on('all', invalidate)
      server.httpServer?.once('close', () => server.watcher.off('all', invalidate))
    },
    configurePreviewServer(server) { server.middlewares.use(middleware('preview')) },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo ?? snapshot()) })
    },
  }
}
