import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FIT, constrain, zoomAt, type ViewTransform } from './viewport'
import type { ApplicableRegion, FinishType } from '../../types/models'
import type { FaceDetection } from './landmarks/mediapipeClient'
import { PhotoMasks } from './photoMasks'
import type { PaintLayer, StrokePoint } from './paintLayer'
import { UVLookup } from './uvLookup'
import { MakeupCompositor } from './webglCompositor'

/** A product applied to a whole region at once. */
export interface AppliedLayer {
  kind: 'region'
  opacity?: number
  region: ApplicableRegion
  color: [number, number, number]
  intensity: number
  finish: FinishType
  order: number
}

/** A product painted on by hand. */
export interface PaintedLayer {
  kind: 'paint'
  region?: ApplicableRegion
  opacity?: number
  layer: PaintLayer
  color: [number, number, number]
  intensity: number
  finish: FinishType
  order: number
}

export type TryOnLayer = AppliedLayer | PaintedLayer

export interface BrushSettings {
  /** Radius in UV units. */
  radius: number
  flow: number
}

interface TryOnCanvasProps {
  bitmap: ImageBitmap
  detection: FaceDetection | null
  layers: TryOnLayer[]
  /** When set, dragging paints into this layer instead of doing nothing. */
  brush?: { target: PaintLayer; settings: BrushSettings } | null
  onStrokeChange?: (points: StrokePoint[]) => void
}

export function TryOnCanvas({
  bitmap,
  detection,
  layers,
  brush = null,
  onStrokeChange,
}: TryOnCanvasProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>(FIT)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [moveTool, setMoveTool] = useState(false)
  const [original, setOriginal] = useState(false)
  const [error, setError] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const space = useRef(false)
  const drag = useRef<'paint' | 'pan' | null>(null)
  const fitScale = Math.min(viewport.width / bitmap.width, viewport.height / bitmap.height)
  const fitted = { width: bitmap.width * fitScale, height: bitmap.height * fitScale }
  const painting = Boolean(brush) && !moveTool && !original
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compositorRef = useRef<MakeupCompositor | null>(null)
  const strokeRef = useRef<{ previous: StrokePoint | null; points: StrokePoint[] } | null>(null)

  useEffect(() => {
    const target = brush?.target
    const activePointers = pointers.current
    return () => {
      target?.cancelStroke()
      strokeRef.current = null
      drag.current = null
      activePointers.clear()
    }
  }, [bitmap, brush?.target])

  const lookup = useMemo(
    () => (detection ? new UVLookup(detection.landmarks) : null),
    [detection],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let compositor: MakeupCompositor
    try { compositor = new MakeupCompositor(canvas); compositorRef.current = compositor }
    catch { setError(true); return }
    return () => {
      compositor.dispose()
      compositorRef.current = null
    }
  }, [])

  useEffect(() => {
    try { compositorRef.current?.setPhoto(bitmap, detection?.landmarks ?? null) }
    catch { setError(true) }
    setView(FIT)
    setOriginal(false)
  }, [bitmap, detection])

  const masks = useMemo(() => detection ? new PhotoMasks(bitmap.width, bitmap.height, detection.landmarks) : null, [bitmap, detection])
  const resolved = useMemo(
    () =>
      [...layers]
        .sort((a, b) => a.order - b.order)
        .flatMap((layer) => {
          const coverage =
            layer.kind === 'region' ? masks?.get(layer.region) : layer.layer.canvas
          return coverage
            ? [{ coverage, color: layer.color, intensity: layer.intensity, finish: layer.finish, region: layer.region, opacity: layer.opacity, photoSpace: layer.kind === 'region' }]
            : []
        }),
    [layers, masks],
  )

  /**
   * Rendered synchronously rather than through requestAnimationFrame: pointer and
   * input events are already delivered at most once per frame, and a queued frame
   * never runs while the tab is hidden, which would leave the canvas stale.
   */
  function draw() {
    try { compositorRef.current?.render(original ? [] : resolved) }
    catch { setError(true) }
  }

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, bitmap, detection, original])

  /** Pointer position in the photo's own 0..1 space, independent of display size. */
  function photoSpace(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }

  function paintAt(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!brush || !lookup || !strokeRef.current) return
    const { x, y } = photoSpace(event)
    const uv = lookup.toUV(x, y)
    if (!uv) {
      // Off the face: break the stroke so it does not leap across the photo.
      strokeRef.current.previous = null
      return
    }

    const point: StrokePoint = { u: uv.x, v: uv.y, startsSegment: strokeRef.current.previous === null }
    brush.target.extendStroke(strokeRef.current.previous, point, brush.settings.radius)
    strokeRef.current.previous = point
    strokeRef.current.points.push(point)
    draw()
  }

  function updateView(next: ViewTransform) { setView(constrain(next, fitted, viewport)) }
  function finishStroke(cancel = false) {
    const stroke = strokeRef.current
    strokeRef.current = null
    if (!stroke || !brush) return
    if (cancel) brush.target.cancelStroke()
    else { brush.target.endStroke(); if (stroke.points.length) onStrokeChange?.(stroke.points) }
    draw()
  }
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLButtonElement)) {
        space.current = true; event.preventDefault()
      }
    }
    const up = () => { space.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up)
    return () => { observer.disconnect(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up) }
  }, [])
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      updateView(zoomAt(view, view.scale * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  })

  return (
    <>
      <div className="viewport__toolbar" role="toolbar" aria-label={t('viewport.tools')}>
        <div className="viewport__group">
          <button type="button" className="tool" aria-label={t('viewport.zoomOut')} onClick={() => updateView(zoomAt(view, view.scale / 1.4))}>−</button>
          <output>{Math.round(view.scale * 100)}%</output>
          <button type="button" className="tool" aria-label={t('viewport.zoomIn')} onClick={() => updateView(zoomAt(view, view.scale * 1.4))}>+</button>
          <button type="button" className="tool" onClick={() => setView(FIT)}>{t('viewport.fit')}</button>
          <button type="button" className="tool" aria-pressed={moveTool} onClick={() => setMoveTool(!moveTool)}>{t('viewport.move')}</button>
        </div>
        <div className="viewport__group">
          <button type="button" className="tool" aria-pressed={original} onClick={() => setOriginal(!original)}>{t(original ? 'viewport.showMakeup' : 'viewport.showOriginal')}</button>
          <button type="button" className="tool" onClick={() => {
            const canvas = canvasRef.current
            canvas?.toBlob(blob => {
              if (!blob) return
              const url = URL.createObjectURL(blob), a = document.createElement('a')
              a.href = url; a.download = 'MakeUp.png'; a.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            })
          }}>{t('viewport.export')}</button>
        </div>
      </div>
      <div ref={viewportRef} className={`viewport ${painting ? 'viewport--paint' : ''}`}
        onDoubleClick={() => updateView(view.scale > 1 ? FIT : zoomAt(view, 2))}
        onPointerDown={event => {
          if (event.button !== 0 && event.button !== 1) return
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          if (pointers.current.size > 1) { finishStroke(true); drag.current = 'pan'; return }
          drag.current = painting && !space.current && event.button === 0 ? 'paint' : 'pan'
          if (drag.current === 'paint' && brush) {
            brush.target.beginStroke(brush.settings.flow)
            strokeRef.current = { previous: null, points: [] }
            paintAt(event as unknown as React.PointerEvent<HTMLCanvasElement>)
          }
        }}
        onPointerMove={event => {
          const old = pointers.current.get(event.pointerId)
          if (!old) return
          const before = [...pointers.current.values()]
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          if (pointers.current.size === 2) {
            const after = [...pointers.current.values()]
            const dist = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
            const rect = event.currentTarget.getBoundingClientRect()
            const cx = (before[0].x + before[1].x) / 2, cy = (before[0].y + before[1].y) / 2
            const next = zoomAt(view, view.scale * dist(after) / Math.max(1, dist(before)), cx - rect.left - rect.width / 2, cy - rect.top - rect.height / 2)
            updateView({ ...next, x: next.x + (after[0].x + after[1].x) / 2 - cx, y: next.y + (after[0].y + after[1].y) / 2 - cy })
          } else if (drag.current === 'paint') paintAt(event as unknown as React.PointerEvent<HTMLCanvasElement>)
          else if (drag.current === 'pan') updateView({ ...view, x: view.x + event.clientX - old.x, y: view.y + event.clientY - old.y })
        }}
        onPointerUp={event => {
          pointers.current.delete(event.pointerId)
          finishStroke()
          if (!pointers.current.size) drag.current = null
        }}
        onPointerCancel={event => { pointers.current.delete(event.pointerId); finishStroke(true); drag.current = null }}
        onLostPointerCapture={event => { pointers.current.delete(event.pointerId); finishStroke(true) }}>
        <canvas ref={canvasRef} className="preview__canvas" aria-label={t('face.title')}
          style={{ width: fitted.width, height: fitted.height, transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})` }} />
        {error && <p className="viewport__error" role="alert">{t('viewport.renderError')}</p>}
        <span className="viewport__badge">{t(original ? 'viewport.original' : 'viewport.makeup')}</span>
        <span className="viewport__hint">{t(painting ? 'viewport.paintHint' : 'viewport.moveHint')}</span>
      </div>
    </>
  )
}
