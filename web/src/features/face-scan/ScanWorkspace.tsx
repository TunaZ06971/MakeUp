import { Link } from 'react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GuidedCapture } from './GuidedCapture'
import { ModelViewer, type ModelBrush } from './ModelViewer'
import {
  download,
  loadScan,
  readScan,
  removeScan,
  saveScan,
  type FaceScan,
} from './scanModel'
import { scanAppearance } from './scanAppearance'
import { CaptureReference } from './CaptureReference'
import type { TryOnLayer } from '../render-engine/TryOnCanvas'
import type { StrokePoint } from '../render-engine/paintLayer'

export function ScanWorkspace({
  uid,
  layers,
  brush,
  onStroke,
  onPhotos,
}: {
  uid: string | undefined
  layers: TryOnLayer[]
  brush: ModelBrush | null
  onStroke: (p: StrokePoint[]) => void
  onPhotos: () => void
}) {
  const { t } = useTranslation(),
    [scan, setScan] = useState<FaceScan | null>(null),
    [capture, setCapture] = useState(false),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [texture, setTexture] = useState<string | HTMLCanvasElement>(''),
    [tick, setTick] = useState(0),
    [reference, setReference] = useState(false),
    [appearance, setAppearance] = useState<Awaited<ReturnType<typeof scanAppearance>> | null>(null),
    [rendered, setRendered] = useState<{
      scan: FaceScan
      layers: TryOnLayer[]
      tick: number
    } | null>(null)
  const updating =
    !!scan &&
    (rendered?.scan !== scan ||
      rendered.layers !== layers ||
      rendered.tick !== tick)
  const file = useRef<HTMLInputElement>(null),
    dirtyTime = useRef(0),
    paintingJob = useRef<AbortController | null>(null),
    pendingPaint = useRef(false)
  useEffect(() => {
    let cancelled = false
    if (!uid) return
    void loadScan(uid)
      .then((s) => {
        if (!cancelled) {
          setScan(s)
          setTexture(s?.texture ?? '')
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [uid])
  const accept = useCallback(
    async (value: FaceScan) => {
      if (!uid) return
      try {
        await saveScan(uid, value)
        setScan(value)
        setTexture(value.texture)
        setCapture(false)
        setError(false)
      } catch {
        setError(true)
      }
    },
    [uid],
  )
  useEffect(() => {
    if (!scan) return
    const controller = new AbortController()
    paintingJob.current = controller
    const timer = setTimeout(() => {
      void scanAppearance(scan, layers, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setTexture(result.atlas)
        setAppearance(result)
        setRendered({ scan, layers, tick })
        setError(false)
      }).catch(() => {
        if (!controller.signal.aborted) { setError(true); setRendered({ scan, layers, tick }) }
      }).finally(() => {
        if (paintingJob.current !== controller) return
        paintingJob.current = null
        if (!controller.signal.aborted && pendingPaint.current) {
          pendingPaint.current = false
          setTick(v => v + 1)
        }
      })
    }, 100)
    return () => {
      controller.abort(); clearTimeout(timer)
      if (paintingJob.current === controller) paintingJob.current = null
    }
  }, [scan, layers, tick])
  const dirty = useCallback(() => {
    if (paintingJob.current) { pendingPaint.current = true; return }
    if (performance.now() - dirtyTime.current > 120) {
      dirtyTime.current = performance.now()
      setTick((v) => v + 1)
    }
  }, [])
  return (
    <section className="card scan-workspace" aria-busy={updating}>
      <div className="scan-heading">
        <div>
          <p className="eyebrow">{t('scan.eyebrow')}</p>
          <h2>{t('scan.model')}</h2>
        </div>
        <div className="capture-actions"><Link className="button" to="/capture">{t('capture.entry')}</Link>
        <button
          className="tool"
          disabled={loading}
          onClick={() => setCapture(true)}
        >
          {t('capture.legacy')}
        </button></div>
      </div>
      <input
        ref={file}
        className="visually-hidden"
        aria-label={t('scan.import')}
        type="file"
        accept=".makeupscan,.json"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            await accept(await readScan(f))
          } catch {
            setError(true)
          }
        }}
      />
      {error && (
        <p className="form__error" role="alert">
          {t('scan.feedback.buildError')}
        </p>
      )}
      {scan ? (
        <>
          <div className="scan-source">
            {t(`scan.sources.${scan.source}`)} · {scan.vertices.length / 3}{' '}
            {t('scan.vertices')} · {t('scan.local')}
            {updating && ` · ${t('scan.updating')}`}
          </div>
          <div className="viewport__group" role="group" aria-label={t('scan.viewMode')}>
            <button className="tool" aria-pressed={!reference} onClick={() => setReference(false)}>{t('scan.surfaceView')}</button>
            <button className="tool" aria-pressed={reference} onClick={() => setReference(true)}>{t('scan.referenceView')}</button>
          </div>
          {reference ? <CaptureReference key={scan.id} scan={scan} images={rendered?.scan === scan ? appearance?.images : undefined} /> : <ModelViewer
            busy={updating}
            scan={scan}
            texture={texture || scan.texture}
            coating={layers.length && rendered?.scan === scan ? appearance?.coating : null}
            brush={brush}
            onStroke={onStroke}
            onDirty={dirty}
          />}
          <p className="scan-footnote">{t(scan.source === 'truedepth-measured' ? 'scan.measuredSurfaceNotice' : 'scan.surfaceNotice')}</p>
        </>
      ) : (
        <div className="scan-empty">
          <div className="scan-orbit">3D</div>
          <h3>{t('scan.intro')}</h3>
          <p>{t('scan.prepare')}</p>
          <p>{t('scan.deviceAdvice')}</p>
          <p>{t('scan.privacy')}</p>
        </div>
      )}
      <div className="scan-actions">
        <button className="tool" onClick={() => file.current?.click()}>
          {t('scan.import')}
        </button>
        {scan && (
          <>
            <button
              className="tool"
              onClick={() =>
                download(
                  new Blob([JSON.stringify(!layers.length && texture instanceof HTMLCanvasElement ? { ...scan, texture: texture.toDataURL() } : scan)], {
                    type: 'application/json',
                  }),
                  'MakeUp-face.makeupscan',
                )
              }
            >
              {t('scan.export')}
            </button>
            <button
              className="tool"
              onClick={async () => {
                try {
                  if (uid) await removeScan(uid)
                  setScan(null)
                } catch {
                  setError(true)
                }
              }}
            >
              {t('scan.delete')}
            </button>
          </>
        )}
        <button className="tool" onClick={onPhotos}>
          {t('scan.photos')}
        </button>
      </div>
      {capture && (
        <GuidedCapture onComplete={accept} onClose={() => setCapture(false)} />
      )}
    </section>
  )
}
