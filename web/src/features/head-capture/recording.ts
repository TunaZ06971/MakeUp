import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { faceCoordinates } from '../face-scan/reconstruction'
import { assessFrame, MAX_CLIP_MS, photoQuality, selectFrames, type Measurement } from './selection'
import type { CaptureFrame, CaptureSegment } from './captureStore'

export interface RecordingProgress {
  elapsedMs: number
  frames: CaptureFrame[]
  analyzedFrames: number
  issue: string
  recording: boolean
}
/** MediaRecorder owns the full-resolution stream; slow face inference only delays feedback. */
export function startRecording(video: HTMLVideoElement, progress: (state: RecordingProgress) => void) {
  let stream: MediaStream | undefined, recorder: MediaRecorder | undefined, worker: Worker | undefined
  let stopped = false, settled = false, started = 0, width = 0, height = 0, raf = 0, interval = 0, fallback = 0
  let busy = false, lastAnalysis = 0, analyzedFrames = 0, issue = 'starting', reason: CaptureSegment['ended'] = 'user'
  let pending: { canvas: HTMLCanvasElement; timeMs: number } | undefined
  let frameWork: Promise<void> = Promise.resolve()
  let frames: CaptureFrame[] = []
  const rejected: Record<string, number> = {}, chunks: Blob[] = []
  const id = crypto.randomUUID(), createdAt = new Date().toISOString()
  let endTime = 0, recordedBytes = 0, analysisDeadline = 0
  let resolveDone: (value: CaptureSegment | null) => void
  const done = new Promise<CaptureSegment | null>(resolve => { resolveDone = resolve })
  const report = () => progress({ elapsedMs: started ? Math.min(MAX_CLIP_MS, performance.now() - started) : 0, frames, analyzedFrames, issue, recording: !!started && !stopped })
  const closeTracks = () => { stream?.getTracks().forEach(t => t.stop()); video.srcObject = null }
  const finalize = async () => {
    if (settled) return
    settled = true
    clearTimeout(fallback)
    await frameWork.catch(() => {})
    closeTracks()
    const mime = recorder?.mimeType || chunks[0]?.type || 'video/webm'
    const blob = new Blob(chunks, { type: mime })
    resolveDone(blob.size && started ? { id, createdAt, durationMs: Math.max(1, endTime - started), width, height, video: blob, frames, analyzedFrames, rejected, ended: reason } : null)
  }
  const stop = (why: CaptureSegment['ended'] = 'user') => {
    if (stopped) return done
    stopped = true; reason = why; endTime = performance.now()
    cancelAnimationFrame(raf); clearInterval(interval); clearTimeout(analysisDeadline); worker?.terminate()
    document.removeEventListener('visibilitychange', hidden)
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); fallback = window.setTimeout(() => { issue = 'recorderError'; void finalize() }, 5000) }
      catch { void finalize() }
    } else { void finalize() }
    closeTracks()
    return done
  }
  const hidden = () => { if (document.hidden) void stop('background') }
  const detectorFailed = () => { clearTimeout(analysisDeadline); issue = 'analysisUnavailable'; worker?.terminate(); worker = undefined; cancelAnimationFrame(raf); report() }
  const tick = (now: number) => {
    if (stopped || !worker) return
    raf = requestAnimationFrame(tick)
    if (busy || now - lastAnalysis < 180 || video.readyState < 2) return
    busy = true; lastAnalysis = now
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1920 / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    pending = { canvas, timeMs: Math.max(0, now - started) }
    const factor = Math.min(1, 640 / canvas.width)
    void createImageBitmap(canvas, { resizeWidth: Math.round(canvas.width * factor), resizeHeight: Math.round(canvas.height * factor) }).then(bitmap => {
      if (stopped || !worker) { bitmap.close(); return }
      analysisDeadline = window.setTimeout(detectorFailed, 5000)
      worker.postMessage({ type: 'frame', bitmap, time: now }, [bitmap])
    }).catch(detectorFailed)
  }
  const analyze = async (result: FaceLandmarkerResult, sample: NonNullable<typeof pending>) => {
    const lm = result.faceLandmarks[0], matrix = result.facialTransformationMatrixes[0]?.data
    const coords = lm?.length >= 468 && matrix?.length === 16 ? faceCoordinates(lm, sample.canvas.width, sample.canvas.height, matrix) : undefined
    const bounds = lm ? [Math.min(...lm.map(p => p.x)), Math.min(...lm.map(p => p.y)), Math.max(...lm.map(p => p.x)), Math.max(...lm.map(p => p.y))] : [NaN, NaN, NaN, NaN]
    const scores = Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(c => [c.categoryName, c.score]))
    const m: Measurement = { timeMs: sample.timeMs, faceCount: coords ? result.faceLandmarks.length : 0, yaw: coords?.yaw ?? 0, pitch: coords?.pitch ?? 0, roll: coords?.roll ?? 0, blink: Math.max(scores.eyeBlinkLeft ?? 0, scores.eyeBlinkRight ?? 0), mouth: scores.jawOpen ?? 0, framed: bounds[0] > .025 && bounds[1] > .07 && bounds[2] < .975 && bounds[3] < .97, faceSize: bounds[3] - bounds[1], ...photoQuality(sample.canvas, bounds) }
    analyzedFrames++
    const assessment = assessFrame(m)
    issue = assessment.issue ?? ''
    if (assessment.issue) rejected[assessment.issue] = (rejected[assessment.issue] ?? 0) + 1
    if (!assessment.view || !coords) return
    const candidate: CaptureFrame = { id: crypto.randomUUID(), segmentId: id, timeMs: sample.timeMs, view: assessment.view, score: assessment.score, yaw: coords.yaw, pitch: coords.pitch, roll: coords.roll, image: new Blob(), landmarks: lm.slice(0, 468).map(({ x, y, z }) => ({ x, y, z })) }
    const selected = selectFrames(frames, candidate)
    if (selected === frames) return
    const image = await new Promise<Blob | null>(resolve => sample.canvas.toBlob(resolve, 'image/jpeg', .93))
    if (image) { candidate.image = image; frames = selected }
  }
  document.addEventListener('visibilitychange', hidden)
  void (async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('secure')
      if (typeof MediaRecorder === 'undefined') throw Error('unsupported')
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw Error('unsupported')
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } } })
      if (stopped) { closeTracks(); return }
      video.srcObject = stream; await video.play()
      if (stopped) { closeTracks(); return }
      width = video.videoWidth; height = video.videoHeight
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
      recorder.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); recordedBytes += e.data.size; if (recordedBytes > 25_000_000) void stop('timeLimit') } }
      recorder.onstop = () => { void finalize() }
      recorder.onerror = () => { issue = 'recorderError'; report(); void stop('error') }
      recorder.start(1000); started = performance.now(); issue = 'starting'; report()
      stream.getVideoTracks()[0].addEventListener('ended', () => { void stop('cameraEnded') }, { once: true })
      interval = window.setInterval(() => { report(); if (performance.now() - started >= MAX_CLIP_MS) void stop('timeLimit') }, 200)
      // Failure of optional analysis must not discard the recorded input.
      try {
        worker = new Worker(new URL('../face-scan/detector.worker.ts', import.meta.url), { type: 'module' })
        worker.onerror = detectorFailed
        worker.onmessage = (event: MessageEvent) => {
          if (stopped) return
          if (event.data.type === 'error') { detectorFailed(); return }
          if (event.data.type === 'ready') { clearTimeout(analysisDeadline); issue = ''; raf = requestAnimationFrame(tick); return }
          if (event.data.type !== 'result' || !pending) return
          clearTimeout(analysisDeadline)
          frameWork = analyze(event.data.result, pending).catch(detectorFailed).finally(() => { busy = false; if (!stopped) report() })
        }
        analysisDeadline = window.setTimeout(detectorFailed, 10000)
        worker.postMessage({ type: 'init' })
      } catch { detectorFailed() }
    } catch (error) {
      if (!stopped) { issue = error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : error instanceof Error && ['secure', 'unsupported'].includes(error.message) ? error.message : 'cameraError'; report(); void stop('error') }
    }
  })()
  return { done, stop }
}
