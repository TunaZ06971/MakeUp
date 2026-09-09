// Stages the MediaPipe vision runtime under public/ so the app never depends on
// a CDN at runtime. The WASM ships inside the npm package; the model weights do
// not, so they are fetched once and cached on disk.
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, stat, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSource = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmTarget = join(root, 'public/mediapipe/wasm')
const modelTarget = join(root, 'public/mediapipe/face_landmarker.task')

// SIMD build plus the fallback MediaPipe loads when the browser lacks SIMD.
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

await mkdir(wasmTarget, { recursive: true })
for (const file of WASM_FILES) {
  await copyFile(join(wasmSource, file), join(wasmTarget, file))
  // UMD loaders need an explicit global binding when imported in an ES module worker.
  if(file.endsWith('.js'))await writeFile(join(wasmTarget,file.replace('.js','.worker.js')),
    'const custom_dbg = (text) => console.debug(text);\n'+(await readFile(join(wasmSource,file),'utf8'))+'\nglobalThis.ModuleFactory = ModuleFactory;\n')
}
console.log(`mediapipe: staged ${WASM_FILES.length} wasm files`)

if (await exists(modelTarget)) {
  console.log('mediapipe: model already present')
} else {
  console.log(`mediapipe: downloading model from ${MODEL_URL}`)
  const response = await fetch(MODEL_URL)
  if (!response.ok) {
    throw new Error(`Failed to download face landmarker model: ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(modelTarget))
  console.log('mediapipe: model downloaded')
}
