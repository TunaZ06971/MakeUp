import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { localDiagnosticsPlugin } from './scripts/local-diagnostics.ts'

export default defineConfig({
  optimizeDeps: { include: ['heic-to/csp'] },
  plugins: [
    react(),
    localDiagnosticsPlugin(),
    {
      name: 'mediapipe-worker-runtime',
      configureServer(server) {
        // MediaPipe imports its UMD adapter as a module in workers. Vite's ?import
        // transform rejects public assets; serve only these two staged adapters verbatim.
        server.middlewares.use((request, response, next) => {
          const name = request.url?.split('?')[0].split('/').pop() ?? ''
          if (
            !request.url?.startsWith('/mediapipe/wasm/') ||
            !/^vision_wasm_(nosimd_)?internal\.worker\.js$/.test(name)
          )
            return next()
          response.setHeader('Content-Type', 'text/javascript')
          response.end(
            readFileSync(
              resolve(import.meta.dirname, 'public/mediapipe/wasm', name),
            ),
          )
        })
      },
    },
    {
      name: 'exclude-private-development-photos',
      apply: 'build',
      closeBundle() {
        rmSync(resolve(import.meta.dirname, 'dist/dev'), {
          recursive: true,
          force: true,
        })
      },
    },
  ],
})
