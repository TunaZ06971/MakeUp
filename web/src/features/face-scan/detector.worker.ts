import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
// MediaPipe calls this hook after importScripts fails inside an ES module worker.
// Keep the runtime URL native so the dev server does not treat /public as a source module.
;(self as unknown as { import: (url: string) => Promise<unknown> }).import = (
  url,
) => import(/* @vite-ignore */ url)
let detector: FaceLandmarker | undefined
self.onmessage = async (event: MessageEvent) => {
  if (event.data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      files.wasmLoaderPath = files.wasmLoaderPath.replace('.js', '.worker.js')
      const options = {
        runningMode: 'VIDEO' as const,
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }
      detector = await FaceLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: {
          modelAssetPath: '/mediapipe/face_landmarker.task',
          delegate: 'CPU',
        },
      })
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) })
    }
    return
  }
  const bitmap: ImageBitmap = event.data.bitmap
  try {
    const result = detector!.detectForVideo(bitmap, event.data.time)
    self.postMessage({ type: 'result', result, time: event.data.time })
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) })
  } finally {
    bitmap.close()
  }
}
