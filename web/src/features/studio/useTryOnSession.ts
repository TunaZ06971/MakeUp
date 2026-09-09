import { useCallback, useMemo, useRef, useState } from 'react'
import { CATEGORY_OPACITY } from '../render-engine/shaders/finishes'
import { hexToRgb } from '../../lib/color'
import type { ApplicableRegion, Product } from '../../types/models'
import { PaintLayer, type Stroke, type StrokePoint } from '../render-engine/paintLayer'
import type { TryOnLayer } from '../render-engine/TryOnCanvas'

export type TryOnMode = 'auto' | 'paint'

/**
 * Makeup is layered the way it is actually applied: base first, then cheeks,
 * then eyes, then lips. Rendering in this order is what lets blush read as
 * sitting on top of foundation rather than beside it.
 */
const REGION_ORDER: ApplicableRegion[] = [
  'faceFull',
  'cheeks',
  'cheekbones',
  'noseBridge',
  'cupidsBow',
  'eyelid',
  'crease',
  'eyelidLine',
  'waterline',
  'eyebrows',
  'lips',
]

export const DEFAULT_INTENSITY = 0.75
export const DEFAULT_BRUSH = { radius: 0.045, flow: 0.5 }

interface AutoApplication {
  product: Product
  intensity: number
}

interface PaintApplication {
  product: Product
  intensity: number
  layer: PaintLayer
  strokes: Stroke[]
}

export function useTryOnSession() {
  const [mode, setMode] = useState<TryOnMode>('auto')
  const [auto, setAuto] = useState<Map<ApplicableRegion, AutoApplication>>(new Map())
  const [painted, setPainted] = useState<Map<string, PaintApplication>>(new Map())
  const [activePaintProductId, setActivePaintProductId] = useState<string | null>(null)
  const [brush, setBrush] = useState(DEFAULT_BRUSH)
  // Bumped whenever a stroke lands, so the render memo sees a change even though
  // the paint canvas is mutated in place.
  const [strokeTick, setStrokeTick] = useState(0)
  const paintLayers = useRef(new Map<string, PaintLayer>())

  const selectProduct = useCallback(
    (product: Product) => {
      if (mode === 'auto') {
        const region = product.applicableRegions[0]
        if (!region) return
        setAuto((previous) => {
          const next = new Map(previous)
          const existing = previous.get(region)
          next.set(region, { product, intensity: existing?.intensity ?? DEFAULT_INTENSITY })
          return next
        })
        return
      }

      setPainted((previous) => {
        if (previous.has(product.id)) return previous
        let layer = paintLayers.current.get(product.id)
        if (!layer) {
          layer = new PaintLayer()
          paintLayers.current.set(product.id, layer)
        }
        const next = new Map(previous)
        next.set(product.id, { product, intensity: DEFAULT_INTENSITY, layer, strokes: [] })
        return next
      })
      setActivePaintProductId(product.id)
    },
    [mode],
  )

  const setIntensity = useCallback((key: string, value: number) => {
    setAuto((previous) => {
      if (!previous.has(key as ApplicableRegion)) return previous
      const next = new Map(previous)
      const entry = next.get(key as ApplicableRegion)!
      next.set(key as ApplicableRegion, { ...entry, intensity: value })
      return next
    })
    setPainted((previous) => {
      if (!previous.has(key)) return previous
      const next = new Map(previous)
      const entry = next.get(key)!
      next.set(key, { ...entry, intensity: value })
      return next
    })
  }, [])

  const remove = useCallback((key: string) => {
    redoStrokes.current.delete(key)
    setAuto((previous) => {
      if (!previous.has(key as ApplicableRegion)) return previous
      const next = new Map(previous)
      next.delete(key as ApplicableRegion)
      return next
    })
    setPainted((previous) => {
      const entry = previous.get(key)
      if (!entry) return previous
      entry.layer.clear()
      const next = new Map(previous)
      next.delete(key)
      return next
    })
    setActivePaintProductId((current) => (current === key ? null : current))
    setStrokeTick((tick) => tick + 1)
  }, [])

  const clearAll = useCallback(() => {
    redoStrokes.current.clear()
    for (const entry of painted.values()) entry.layer.clear()
    setAuto(new Map())
    setPainted(new Map())
    setActivePaintProductId(null)
    setStrokeTick((tick) => tick + 1)
  }, [painted])

  /** Records a finished stroke so the look stays reproducible. */
  const commitStroke = useCallback(
    (points: StrokePoint[]) => {
      const productId = activePaintProductId
      if (!productId) return
      redoStrokes.current.delete(productId)
      setPainted((previous) => {
        const entry = previous.get(productId)
        if (!entry) return previous
        const stroke: Stroke = {
          productId,
          colorIndex: 0,
          radius: brush.radius,
          flow: brush.flow,
          points,
        }
        const next = new Map(previous)
        next.set(productId, { ...entry, strokes: [...entry.strokes, stroke] })
        return next
      })
      setStrokeTick((tick) => tick + 1)
    },
    [activePaintProductId, brush],
  )

  const redoStrokes = useRef(new Map<string, Stroke[]>())
  const undoStroke = () => {
    if (!activePaintProductId) return
    const entry = painted.get(activePaintProductId)
    if (!entry?.strokes.length) return
    const strokes = entry.strokes.slice(0, -1)
    redoStrokes.current.set(activePaintProductId, [...(redoStrokes.current.get(activePaintProductId) ?? []), entry.strokes.at(-1)!])
    entry.layer.clear(); for (const stroke of strokes) entry.layer.replay(stroke)
    setPainted(new Map(painted).set(activePaintProductId, { ...entry, strokes }))
  }
  const redoStroke = () => {
    if (!activePaintProductId) return
    const entry = painted.get(activePaintProductId), stroke = redoStrokes.current.get(activePaintProductId)?.pop()
    if (!entry || !stroke) return
    entry.layer.replay(stroke)
    setPainted(new Map(painted).set(activePaintProductId, { ...entry, strokes: [...entry.strokes, stroke] }))
  }
  const activePaint = activePaintProductId ? painted.get(activePaintProductId) : undefined

  const layers = useMemo<TryOnLayer[]>(() => {
    const regionLayers: TryOnLayer[] = []
    for (const [region, entry] of auto) {
      const color = hexToRgb(entry.product.colors[0]?.hex ?? '')
      if (!color) continue
      regionLayers.push({
        kind: 'region',
        region,
        color,
        intensity: entry.intensity,
        finish: entry.product.finish,
        opacity: entry.product.opacity ?? CATEGORY_OPACITY[entry.product.category],
        order: REGION_ORDER.indexOf(region),
      })
    }

    const paintedLayers: TryOnLayer[] = []
    for (const entry of painted.values()) {
      const color = hexToRgb(entry.product.colors[0]?.hex ?? '')
      if (!color) continue
      paintedLayers.push({
        kind: 'paint',
        region: entry.product.applicableRegions[0],
        layer: entry.layer,
        color,
        intensity: entry.intensity,
        finish: entry.product.finish,
        opacity: entry.product.opacity ?? CATEGORY_OPACITY[entry.product.category],
        // Hand-painted product goes on top of the automatic pass.
        order: REGION_ORDER.length,
      })
    }

    return [...regionLayers, ...paintedLayers]
    // strokeTick is the signal that a paint canvas changed in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, painted, strokeTick])

  return {
    undoStroke, redoStroke,
    canUndo: Boolean(activePaint?.strokes.length),
    canRedo: Boolean(activePaintProductId && redoStrokes.current.get(activePaintProductId)?.length),
    mode,
    setMode,
    auto,
    painted,
    layers,
    brush,
    setBrush,
    activePaint,
    activePaintProductId,
    setActivePaintProductId,
    selectProduct,
    setIntensity,
    remove,
    clearAll,
    commitStroke,
    paintLayers,
    setPainted,
    setAuto,
    setStrokeTick,
  }
}
