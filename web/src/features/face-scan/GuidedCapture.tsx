import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { ScanProtocol, captureSteps, type CaptureSide, type Observation } from './scanProtocol'
import {
  bakeAtlas,
  MODEL_TRIANGLES,
  faceCoordinates,
  frameWeights,
  newRGBScan,
} from './reconstruction'
import type { FaceScan, ScanFrame } from './scanModel'

export function GuidedCapture({
  onComplete,
  onClose,
}: {
  onComplete: (scan: FaceScan) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [side, setSide] = useState<CaptureSide>('left')
  const steps = captureSteps(side)
  const video = useRef<HTMLVideoElement>(null),
    stopRef = useRef(() => {}),
    skipRef = useRef(() => {})
  const [started, setStarted] = useState(false),
    [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState(''),
    [stage, setStage] = useState(0),
    [hold, setHold] = useState(0),
    [error, setError] = useState('')
  useEffect(() => {
    if (!started) return
    let disposed = false,
      cancelled = false,
      stream: MediaStream | undefined,
      worker: Worker | undefined,
      raf = 0,
      busy = false,
      last = 0
    let sample: HTMLCanvasElement | undefined
    const protocol = new ScanProtocol(side),
      frames: ScanFrame[] = [],
      expressions: FaceScan['expressions'] = {}
    skipRef.current = () => {
      if (!cancelled && protocol.skipProfile()) { setStage(protocol.index); setHold(0); setStatus('') }
    }
    const stop = () => {
      cancelled = true
      cancelAnimationFrame(raf)
      worker?.terminate()
      stream?.getTracks().forEach((track) => track.stop())
      if (video.current) video.current.srcObject = null
    }
    stopRef.current = () => {
      disposed = true
      stop()
    }
    const fail = (key: string) => {
      stop()
      setError(key)
    }
    const hidden = () => {
      if (document.hidden) {
        disposed = true
        fail('interrupted')
      }
    }
    document.addEventListener('visibilitychange', hidden)
    const tick = (time: number) => {
      if (cancelled) return
      raf = requestAnimationFrame(tick)
      if (
        busy ||
        time - last < 100 ||
        !video.current ||
        video.current.readyState < 2
      )
        return
      busy = true
      last = time
      const v = video.current,
        scale = Math.min(1, 1920 / v.videoWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
      sample = canvas
      void createImageBitmap(canvas)
        .then((bitmap) => {
          if (cancelled) {
            bitmap.close()
            return
          }
          worker!.postMessage({ type: 'frame', bitmap, time }, [bitmap])
        })
        .catch(() => fail('cameraError'))
    }
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          fail('secure')
          return
        }
        setStatus('starting')
        setError('')
        setStage(0)
        setHold(0)
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 24, max: 30 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const v = video.current!
        v.srcObject = stream
        await v.play()
        if (cancelled) return
        worker = new Worker(new URL('./detector.worker.ts', import.meta.url), {
          type: 'module',
        })
        worker.onerror = () => fail('detectorError')
        worker.onmessage = async (event: MessageEvent) => {
          if (cancelled) return
          if (event.data.type === 'error') {
            fail('detectorError')
            return
          }
          if (event.data.type === 'ready') {
            raf = requestAnimationFrame(tick)
            return
          }
          if (event.data.type !== 'result' || !sample) return
          const result = event.data.result as FaceLandmarkerResult,
            canvas = sample,
            lm = result.faceLandmarks[0]
          const scores = Object.fromEntries(
            (result.faceBlendshapes[0]?.categories ?? []).map((c) => [
              c.categoryName,
              c.score,
            ]),
          )
          const matrix = result.facialTransformationMatrixes[0]?.data
          const coords =
            lm?.length >= 468 && matrix?.length === 16
              ? faceCoordinates(lm, canvas.width, canvas.height, matrix)
              : null
          const points = lm?.slice(0, 468) ?? [],
            xs = points.map((p) => p.x),
            ys = points.map((p) => p.y)
          const minX = Math.min(...xs),
            maxX = Math.max(...xs),
            minY = Math.min(...ys),
            maxY = Math.max(...ys)
          const quality = imageQuality(canvas, minX, minY, maxX, maxY)
          const observation: Observation = {
            time: event.data.time,
            faceCount: result.faceLandmarks.length,
            tracking: !!coords,
            yaw: coords?.yaw ?? 0,
            pitch: coords?.pitch ?? 0,
            roll: coords?.roll ?? 0,
            blink: Math.min(
              scores.eyeBlinkLeft ?? 0,
              scores.eyeBlinkRight ?? 0,
            ),
            mouth: scores.jawOpen ?? 0,
            faceSize: maxY - minY,
            centered:
              Math.abs((minX + maxX) / 2 - 0.5) < 0.2 &&
              minY > 0.025 &&
              maxY < 0.98,
            ...quality,
          }
          const action = protocol.update(observation)
          setStage(protocol.index)
          setHold(protocol.progress)
          setStatus(action.issue ?? '')
          if (action.captureExpression && coords)
            expressions[action.captureExpression] = coords.vertices
          if (
            action.accepted &&
            !['blink', 'mouth'].includes(action.accepted) &&
            coords
          ) {
            frames.push({
              step: action.accepted,
              image: canvas.toDataURL('image/jpeg', 0.92),
              projection: points.flatMap((p) => [p.x, p.y]),
              vertices: coords.vertices,
              weights: frameWeights(coords.camera, MODEL_TRIANGLES),
              landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            })
          }
          if (protocol.complete) {
            stop()
            setStatus('building')
            try {
              const scan = newRGBScan(frames, expressions, protocol.steps.filter(step => !protocol.skippedSteps.includes(step)))
              scan.texture = (await bakeAtlas(scan)).toDataURL('image/png')
              if (!disposed) onComplete(scan)
            } catch {
              if (!disposed) setError('buildError')
            }
          }
          busy = false
        }
        worker.postMessage({ type: 'init' })
      } catch (error) {
        fail(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'denied'
            : 'cameraError',
        )
      }
    })()
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [started, attempt, onComplete, side])
  return (
    <div
      className="scan-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t('scan.title')}
    >
      <div className="scan-dialog__body">
        <div className="scan-heading">
          <div>
            <p className="eyebrow">{t('scan.eyebrow')}</p>
            <h2>{t('scan.title')}</h2>
          </div>
          <button
            className="tool"
            onClick={() => {
              stopRef.current()
              onClose()
            }}
          >
            {t('scan.close')}
          </button>
        </div>
        {!started ? (
          <div className="scan-intro">
            <h3>{t('scan.intro')}</h3>
            <p>{t('scan.prepare')}</p>
            <p>{t('scan.rgbNotice')}</p>
            <label>{t('scan.captureSide')} <select value={side} onChange={e => setSide(e.target.value as CaptureSide)}>
              <option value="left">{t('scan.captureLeft')}</option>
              <option value="right">{t('scan.captureRight')}</option>
              <option value="both">{t('scan.captureBoth')}</option>
            </select></label>
            <p>{t('scan.privacy')}</p>
            <button className="button" onClick={() => setStarted(true)}>
              {t('scan.startCamera')}
            </button>
          </div>
        ) : (
          <>
            <div className="scan-camera">
              <video ref={video} muted playsInline />
              <div className="scan-guide" />
              <span className="scan-camera__badge">{t('scan.local')}</span>
            </div>
            <div className="scan-instruction" aria-live="polite">
              <span>{Math.min(stage + 1, 8)} / 8</span>
              <h3>{t(`scan.steps.${steps[Math.min(stage, 7)]}`)}</h3>
              <p>{t(`scan.feedback.${error || status || 'hold'}`)}</p>
              <progress value={hold} max={1} />
              {['leftProfile', 'rightProfile'].includes(steps[Math.min(stage, 7)]) && <button className="tool" onClick={() => skipRef.current()}>{t('scan.skipProfile')}</button>}
            </div>
            <ol className="scan-steps">
              {steps.map((step, i) => (
                <li
                  key={step}
                  className={i < stage ? 'done' : i === stage ? 'active' : ''}
                >
                  {i < stage ? '✓ ' : ''}
                  {t(`scan.short.${step}`)}
                </li>
              ))}
            </ol>
            {error && (
              <button
                className="button"
                onClick={() => {
                  setError('')
                  setAttempt((v) => v + 1)
                }}
              >
                {t('scan.retry')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
function imageQuality(
  image: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  if (![x0, y0, x1, y1].every(Number.isFinite))
    return { brightness: 0, sharpness: 0 }
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(
    image,
    Math.max(0, x0) * image.width,
    Math.max(0, y0) * image.height,
    (x1 - x0) * image.width,
    (y1 - y0) * image.height,
    0,
    0,
    96,
    96,
  )
  const d = ctx.getImageData(0, 0, 96, 96).data,
    g = new Float32Array(96 * 96)
  let mean = 0,
    sharp = 0
  for (let i = 0; i < g.length; i++) {
    g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]
    mean += g[i]
  }
  for (let y = 1; y < 95; y++)
    for (let x = 1; x < 95; x++) {
      let i = y * 96 + x
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - 96] - g[i + 96]
      sharp += lap * lap
    }
  return { brightness: mean / g.length / 255, sharpness: sharp / (94 * 94) }
}
