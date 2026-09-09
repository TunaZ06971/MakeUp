import { createRoot } from 'react-dom/client'
import '../src/i18n'
import { ModelViewer } from '../src/features/face-scan/ModelViewer'
import { bakeAtlas, decodeDataImage } from '../src/features/face-scan/reconstruction'
import { validateScan, type FaceScan } from '../src/features/face-scan/scanModel'
import { MakeupCompositor } from '../src/features/render-engine/webglCompositor'
import { surfaceMaterial } from '../src/features/face-scan/surfaceMaterial'
import { PhotoMasks } from '../src/features/render-engine/photoMasks'
const root = createRoot(document.getElementById('root')!)
Object.assign(window, {
  reviewScan: async (value: FaceScan, rebuild: boolean, makeup = false) => {
    const scan = validateScan(value)
    let images: HTMLCanvasElement[] | undefined
    if (makeup) {
      images = []
      const compositor = new MakeupCompositor(document.createElement('canvas'))
      try {
        for (const frame of scan.frames) {
          const bitmap = await createImageBitmap(await decodeDataImage(frame.image))
          const points = frame.landmarks!.map(p => ({ ...p, visibility: 1 }))
          compositor.setPhoto(bitmap, points)
          compositor.render([{ coverage: new PhotoMasks(bitmap.width, bitmap.height, points).get('lips'), photoSpace: true,
            region: 'lips', color: [.729, .102, .153], intensity: .65, opacity: .92, finish: 'matte', surfaceMode: true }])
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
          canvas.getContext('2d')!.drawImage(compositor.canvas, 0, 0)
          images.push(canvas); bitmap.close()
        }
      } finally { compositor.dispose() }
    }
    const texture = rebuild || makeup ? (await bakeAtlas(scan, images)).toDataURL() : scan.texture
    const coating = makeup ? await surfaceMaterial(scan, [{ kind: 'region', region: 'lips', color: [.729, .102, .153], intensity: .65, opacity: .92, finish: 'matte', order: 1 }]) : null
    root.render(<ModelViewer coating={coating} scan={scan} texture={texture} brush={null} onStroke={() => {}} onDirty={() => {}} busy={false} />)
    return texture
  },
})
