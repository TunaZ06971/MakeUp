import { detectFace } from '../src/features/render-engine/landmarks/mediapipeClient'
import {
  faceCoordinates,
  frameWeights,
  newRGBScan,
  MODEL_TRIANGLES,
  bakeAtlas,
} from '../src/features/face-scan/reconstruction'
import { validateScan } from '../src/features/face-scan/scanModel'
// Deterministic renderer fixture, NOT evidence that a live multiview scan succeeded.
Object.assign(window, {
  createScanFixture: async () => {
    const bitmap = await createImageBitmap(
      await (await fetch('/dev/face2.jpg')).blob(),
    )
    const face = await detectFace(bitmap)
    if (!face) throw Error('Missing fixture face')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const coords = faceCoordinates(
        face.landmarks,
        bitmap.width,
        bitmap.height,
        face.transformMatrix,
      ),
      image = canvas.toDataURL('image/jpeg', 0.92)
    const frames = ['front', 'left', 'right', 'up', 'down', 'finish'].map(
      (step) => ({
        step,
        image,
        vertices: coords.vertices,
        projection: face.landmarks.slice(0, 468).flatMap((p) => [p.x, p.y]),
        weights: frameWeights(coords.camera, MODEL_TRIANGLES),
        landmarks: face.landmarks.slice(0, 468),
      }),
    )
    const scan = newRGBScan(frames, {}, [])
    scan.id = 'synthetic-renderer-fixture'
    scan.texture = (await bakeAtlas(scan)).toDataURL()
    validateScan(scan)
    bitmap.close()
    return {
      scan,
      yaw: coords.yaw,
      pitch: coords.pitch,
      roll: coords.roll,
      matrix: face.transformMatrix,
    }
  },
  atlasTest: async () => {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const ctx = c.getContext('2d')!
    for (const [x, y, color] of [
      [0, 0, '#ff0000'],
      [16, 0, '#00ff00'],
      [0, 16, '#0000ff'],
      [16, 16, '#ffffff'],
    ] as const) {
      ctx.fillStyle = color
      ctx.fillRect(x, y, 16, 16)
    }
    const frame = {
      step: 'front',
      image: c.toDataURL(),
      vertices: [],
      projection: [0.01, 0.01, 0.99, 0.01, 0.99, 0.99, 0.01, 0.99],
      weights: [1, 1],
    }
    const atlas = await bakeAtlas(
      {
        uv: [0.01, 0.99, 0.99, 0.99, 0.99, 0.01, 0.01, 0.01],
        triangles: [0, 1, 2, 0, 2, 3],
        frames: [frame, { ...frame, weights: [0, 0] }],
      },
      [c, c],
    )
    const a = atlas.getContext('2d')!
    return [
      [256, 256],
      [768, 256],
      [256, 768],
      [768, 768],
    ].map(([x, y]) => Array.from(a.getImageData(x, y, 1, 1).data))
  },
})

Object.assign(window, {
  runScanWorker: async () => {
    const worker = new Worker(
      new URL('../src/features/face-scan/detector.worker.ts', import.meta.url),
      { type: 'module' },
    )
    try {
      return await new Promise((resolve, reject) => {
        worker.onerror = reject
        worker.onmessage = async (e) => {
          if (e.data.type === 'error') reject(Error(e.data.message))
          if (e.data.type === 'ready') {
            const bitmap = await createImageBitmap(
              await (await fetch('/dev/face2.jpg')).blob(),
            )
            worker.postMessage({ type: 'frame', bitmap, time: 1000 }, [bitmap])
          }
          if (e.data.type === 'result')
            resolve({
              count: e.data.result.faceLandmarks.length,
              points: e.data.result.faceLandmarks[0].length,
              matrix: e.data.result.facialTransformationMatrixes[0].data.length,
            })
        }
        worker.postMessage({ type: 'init' })
      })
    } finally {
      worker.terminate()
    }
  },
})
