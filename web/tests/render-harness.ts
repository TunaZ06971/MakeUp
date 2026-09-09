import { decodeImage } from '../src/lib/localPhotoStore'
import { MakeupCompositor } from '../src/features/render-engine/webglCompositor'
import { PhotoMasks } from '../src/features/render-engine/photoMasks'
import { detectFace } from '../src/features/render-engine/landmarks/mediapipeClient'
import { PaintLayer } from '../src/features/render-engine/paintLayer'
import { zoomAt, constrain } from '../src/features/render-engine/viewport'

// This page is a local test entry, excluded from Vite's production entry graph.
async function run() {
  const blob = await (await fetch('/dev/face2.jpg')).blob()
  const bitmap = await createImageBitmap(blob)
  const face = await detectFace(bitmap)
  if (!face) throw Error('No face in local test fixture')
  const masks = new PhotoMasks(bitmap.width, bitmap.height, face.landmarks)
  const canvas = document.createElement('canvas')
  const engine = new MakeupCompositor(canvas)
  engine.setPhoto(bitmap, face.landmarks)
  const context = document.createElement('canvas')
  context.width = bitmap.width; context.height = bitmap.height
  const ctx = context.getContext('2d', { willReadFrequently: true })!
  const read = () => { ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, context.width, context.height).data }
  ctx.drawImage(bitmap, 0, 0)
  const source = ctx.getImageData(0, 0, context.width, context.height).data
  engine.render([])
  const bare = read()
  let noMakeupError = 0
  for (let i = 0; i < bare.length; i++) noMakeupError = Math.max(noMakeupError, Math.abs(bare[i] - source[i]))
  const layer = {coverage: masks.get('lips'), photoSpace: true, region: 'lips' as const, color: [0.706, 0.141, 0.227] as [number, number, number], intensity: 0.9, finish: 'matte' as const, opacity: 0.98}
  const alpha = layer.coverage.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data
  let changedOutside = 0, changedInside = 0, totalInside = 0, mattePeak = 0, glossyPeak = 0, finishDelta = 0
  const shots: Record<string,string> = {bare:canvas.toDataURL()}
  engine.render([layer]); const matte = read(); shots.matte = canvas.toDataURL()
  engine.render([{...layer, finish: 'dewy'}]); const dewy = read(); shots.dewy = canvas.toDataURL()
  for (let i = 0; i < matte.length; i += 4) {
    const change = Math.abs(matte[i]-bare[i])+Math.abs(matte[i+1]-bare[i+1])+Math.abs(matte[i+2]-bare[i+2])
    if (alpha[i+3] === 0 && change > 3) changedOutside++
    if (alpha[i+3] > 240) {
      changedInside += change > 5 ? 1 : 0; totalInside++
      mattePeak = Math.max(mattePeak, matte[i]+matte[i+1]+matte[i+2])
      glossyPeak = Math.max(glossyPeak, dewy[i]+dewy[i+1]+dewy[i+2])
      finishDelta += Math.abs(matte[i]-dewy[i])+Math.abs(matte[i+1]-dewy[i+1])+Math.abs(matte[i+2]-dewy[i+2])
    }
  }
  engine.render([{...layer,intensity:0}]); const zero = read()
  const zeroIdentical = zero.every((v,i) => v === bare[i])
  engine.render([
    {...layer, region:'cheeks', coverage:masks.get('cheeks'), color:[0.90,0.55,0.53], opacity:0.28, intensity:0.65, finish:'satin'},
    {...layer, region:'eyelid', coverage:masks.get('eyelid'), color:[0.44,0.24,0.20], opacity:0.65, intensity:0.5},
    layer,
  ]); shots.full = canvas.toDataURL()
  const paint = new PaintLayer()
  const stroke = { productId:'test', colorIndex:0, radius:0.015, flow:0.4, points:[{u:0.35,v:0.5,startsSegment:true},{u:0.37,v:0.5},{u:0.65,v:0.5,startsSegment:true}] }
  paint.replay(stroke)
  const paintContext = paint.canvas.getContext('2d')!
  const gapValue = paintContext.getImageData(512,512,1,1).data[0]
  const beforeCancel = paint.canvas.toDataURL()
  paint.beginStroke(0.5);paint.extendStroke(null,{u:0.5,v:0.5},0.03);paint.cancelStroke()
  const cancelExact = beforeCancel === paint.canvas.toDataURL()
  paint.clear();paint.replay(stroke)
  const replayExact = beforeCancel === paint.canvas.toDataURL()
  const z = zoomAt({scale:2,x:20,y:10},4,100,50)
  const zoomAnchorExact = Math.abs((100-z.x)/z.scale - (100-20)/2)<1e-9
  const bounded = constrain({scale:1,x:999,y:999},{width:400,height:300},{width:400,height:300})
  // Display the real raster outputs for a visual audit, not just metrics.
  for(const [name,url] of Object.entries(shots)) {
    const section=document.createElement('section');const title=document.createElement('h2');title.textContent=name
    const image=document.createElement('img');image.src=url;image.style.width='440px';section.append(title,image);document.body.append(section)
  }
  engine.dispose();bitmap.close()
  return { noMakeupError, changedOutside, changedInside, totalInside, mattePeak, glossyPeak, finishDelta:finishDelta/Math.max(1,totalInside), zeroIdentical, gapValue, cancelExact, replayExact, zoomAnchorExact, fitPanZero:bounded.x===0&&bounded.y===0, shots }
}
Object.assign(window,{runRendererTests:run, testHEIC: async () => {
  const blob = await (await fetch('/dev/face1.heic')).blob()
  const bitmap = await decodeImage(blob)
  const detected = await detectFace(bitmap)
  const size = {width:bitmap.width,height:bitmap.height,detected:Boolean(detected)}
  bitmap.close();return size
}})
