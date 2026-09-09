import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'

/// The runtime and model are served from `public/mediapipe/` (staged by
/// `scripts/setup-mediapipe.mjs`) so nothing is fetched from a CDN at runtime.
const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/face_landmarker.task'

export interface FaceDetection {
  /** 478 landmarks (468 face + 10 iris) in normalized 0..1 image coordinates. */
  landmarks: NormalizedLandmark[]
  /** Column-major 4x4 head pose, used later as a light-direction proxy. */
  transformMatrix?: number[]
}

let landmarkerPromise: Promise<FaceLandmarker> | null = null

async function createLandmarker(delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  })
}

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= createLandmarker('GPU').catch((error) => {
    console.warn('MediaPipe GPU delegate unavailable, falling back to CPU', error)
    return createLandmarker('CPU')
  }).catch(error => { landmarkerPromise = null; throw error })
  return landmarkerPromise
}

export async function detectFace(
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
): Promise<FaceDetection | null> {
  const landmarker = await loadFaceLandmarker()
  const result = landmarker.detect(image)
  const landmarks = result.faceLandmarks.at(0)
  if (!landmarks) return null

  return {
    landmarks,
    transformMatrix: result.facialTransformationMatrixes?.at(0)?.data,
  }
}
