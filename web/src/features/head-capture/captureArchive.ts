import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { MAX_CAPTURE_BYTES, validateCapture, type HeadCapture, type CaptureSegment, type CaptureFrame } from './captureStore'

type StoredFrame = Omit<CaptureFrame, 'image'> & { imagePath: string }
type StoredSegment = Omit<CaptureSegment, 'video' | 'frames'> & { videoPath: string; mimeType: string; frames: StoredFrame[] }
interface Manifest extends Omit<HeadCapture, 'segments'> { segments: StoredSegment[] }
export async function exportCapture(capture: HeadCapture): Promise<Blob> {
  validateCapture(capture)
  const files: Record<string, Uint8Array> = {}, segments: StoredSegment[] = []
  for (const { video, frames, ...segment } of capture.segments) {
    const videoPath = `segments/${segment.id}.${video.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`
    files[videoPath] = new Uint8Array(await video.arrayBuffer())
    const stored: StoredFrame[] = []
    for (const { image, ...frame } of frames) { const imagePath = `frames/${frame.id}.jpg`; files[imagePath] = new Uint8Array(await image.arrayBuffer()); stored.push({ ...frame, imagePath }) }
    segments.push({ ...segment, videoPath, mimeType: video.type, frames: stored })
  }
  files['manifest.json'] = strToU8(JSON.stringify({ ...capture, segments } satisfies Manifest))
  // Images and video are already compressed. Store them without lossy re-encoding.
  return new Blob([zipSync(files, { level: 0 }).slice().buffer], { type: 'application/zip' })
}
export async function importCapture(file: Blob): Promise<HeadCapture> {
  if (file.size > MAX_CAPTURE_BYTES + 4_000_000) throw Error('Capture too large')
  let total = 0, count = 0
  const sizes = new Map<string, number>()
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
    if (![entry.size, entry.originalSize].every(n => Number.isSafeInteger(n) && n >= 0) || ![0, 8].includes(entry.compression) || (entry.compression === 0 && entry.size !== entry.originalSize) || sizes.has(entry.name)) throw Error('Invalid archive sizes')
    sizes.set(entry.name, entry.originalSize)
    total += entry.originalSize; count++
    if (total > MAX_CAPTURE_BYTES + 4_000_000 || count > 65 || entry.originalSize > MAX_CAPTURE_BYTES || !/^(manifest\.json|segments\/[\w-]{1,80}\.(webm|mp4)|frames\/[\w-]{1,80}\.jpg)$/.test(entry.name)) throw Error('Invalid archive entry')
    return true
  } })
  for (const [name, bytes] of Object.entries(files)) if (bytes.length !== sizes.get(name)) throw Error('Invalid archive size')
  if (!files['manifest.json'] || files['manifest.json'].length > 4_000_000) throw Error('Invalid manifest')
  const m = JSON.parse(strFromU8(files['manifest.json'])) as Manifest
  if (!Array.isArray(m.segments) || m.segments.length > 4) throw Error('Invalid clips')
  const used = new Set(['manifest.json'])
  const read = (path: string, type: string) => { if (typeof path !== 'string' || !files[path] || used.has(path)) throw Error('Missing or duplicate file'); used.add(path); return new Blob([files[path].slice().buffer], { type }) }
  const capture = { ...m, segments: m.segments.map(s => {
    if (!Array.isArray(s.frames) || s.frames.length > 14 || !/^segments\/[\w-]+\.(webm|mp4)$/.test(s.videoPath)) throw Error('Invalid clip')
    const { videoPath, mimeType, frames, ...rest } = s
    return { ...rest, video: read(videoPath, mimeType), frames: frames.map(f => { if (!/^frames\/[\w-]+\.jpg$/.test(f.imagePath)) throw Error('Invalid frame path'); const { imagePath, ...frame } = f; return { ...frame, image: read(imagePath, 'image/jpeg') } }) }
  }) }
  if (used.size !== Object.keys(files).length) throw Error('Unexpected archive data')
  return validateCapture(capture)
}
