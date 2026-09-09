import { LocalStatus } from '../../components/LocalStatus'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageToggle } from '../../components/LanguageToggle'
import { createLook, type Look } from '../../lib/firestore/looks'
import { fetchProducts } from '../../lib/firestore/products'
import type { Product } from '../../types/models'
import { signOutUser } from '../auth/authActions'
import { useAuth } from '../auth/authContext'
import { CatalogPanel } from '../catalog/CatalogPanel'
import { FacePanel } from '../face-import/FacePanel'
import { PaintLayer } from '../render-engine/paintLayer'
import { usePhotoLibrary } from '../face-import/usePhotoLibrary'
import { AppliedList, type AppliedEntry } from './AppliedList'
import { BrushControls } from './BrushControls'
import { LooksPanel } from './LooksPanel'
import { useTryOnSession } from './useTryOnSession'
import { ScanWorkspace } from '../face-scan/ScanWorkspace'

export function StudioPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const uid = user?.uid

  const library = usePhotoLibrary(uid)
  const session = useTryOnSession()
  const [panel, setPanel] = useState<'products' | 'applied' | 'looks'>('products')
  const [selectedId, setSelectedId] = useState<string>()
  const [looksRevision, setLooksRevision] = useState(0)
  const [viewMode, setViewMode] = useState<'model' | 'photos'>('model')

  const entries: AppliedEntry[] = [
    ...[...session.auto.entries()].map(([region, entry]) => ({
      key: region,
      product: entry.product,
      intensity: entry.intensity,
      paintable: false,
      active: false,
    })),
    ...[...session.painted.entries()].map(([productId, entry]) => ({
      key: productId,
      product: entry.product,
      intensity: entry.intensity,
      paintable: true,
      active: productId === session.activePaintProductId,
    })),
  ]

  const brush =
    session.mode === 'paint' && session.activePaint
      ? { target: session.activePaint.layer, settings: session.brush }
      : null

  const handleSave = useCallback(
    async (title: string) => {
      if (!uid) return
      await createLook({
        ownerUid: uid,
        title,
        applied: [...session.auto.entries()].map(([region, entry]) => ({
          productId: entry.product.id,
          colorIndex: 0,
          region,
          intensity: entry.intensity,
        })),
        painted: [...session.painted.values()].map((entry) => ({
          productId: entry.product.id,
          colorIndex: 0,
          intensity: entry.intensity,
          strokes: entry.strokes,
        })),
      })
      setLooksRevision((revision) => revision + 1)
    },
    [uid, session.auto, session.painted],
  )

  /**
   * Replaying a saved look needs the products themselves, which live in
   * Firestore rather than in the look, so the catalog is re-read and matched by id.
   */
  const handleApply = useCallback(
    async (look: Look) => {
      const catalog = await fetchProducts()
      const byId = new Map(catalog.map((product) => [product.id, product]))

      if ([...look.applied, ...look.painted].some(entry => !byId.has(entry.productId))) {
        throw new Error('A saved product is no longer in the catalog')
      }

      session.clearAll()

      const auto = new Map<Product['applicableRegions'][number], { product: Product; intensity: number }>()
      for (const entry of look.applied) {
        const product = byId.get(entry.productId)
        if (product) auto.set(entry.region, { product, intensity: entry.intensity })
      }
      session.setAuto(auto)

      const painted = new Map<string, ReturnType<typeof buildPaint>>()
      for (const entry of look.painted) {
        const product = byId.get(entry.productId)
        if (!product) continue
        painted.set(entry.productId, buildPaint(product, entry, session.paintLayers.current))
      }
      session.setPainted(painted)
      session.setStrokeTick((tick) => tick + 1)
    },
    [session],
  )

  return (
    <div className="shell shell--studio">
      <header className="shell__header">
        <div>
          <h1 className="shell__title">{t('app.name')}</h1>
          <p className="shell__tagline">
            {t('studio.subtitle')}
          </p>
        </div>
        <div className="shell__actions">
          <LanguageToggle />
          <button className="button button--ghost" type="button" onClick={signOutUser}>
            {t('auth.signOut')}
          </button>
        </div>
      </header>

      <LocalStatus />
      <div className="studio">
        {viewMode === 'model' ? <ScanWorkspace uid={uid} layers={session.layers} brush={brush} onStroke={session.commitStroke} onPhotos={() => setViewMode('photos')} /> : <div className="studio-photos">
        <button className="tool" onClick={() => setViewMode('model')}>{t('scan.back')}</button>
        <FacePanel
          views={library.views}
          active={library.active}
          loading={library.loading}
          error={library.error}
          layers={session.layers}
          brush={brush}
          onSelectView={library.setActiveId}
          onAddPhotos={(files) => void library.addPhotos(files)}
          onRemovePhoto={(id) => void library.removePhoto(id)}
          onStroke={session.commitStroke}
        />
        </div>}

        <aside className="studio__sidebar">
        <div className="modes" role="group" aria-label={t('tryOn.modeAuto')}>
          <button
            type="button"
            className="chip"
            aria-pressed={session.mode === 'auto'}
            onClick={() => session.setMode('auto')}
          >
            {t('tryOn.modeAuto')}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={session.mode === 'paint'}
            onClick={() => session.setMode('paint')}
          >
            {t('tryOn.modePaint')}
          </button>
          <span className="modes__hint">
            {session.mode === 'auto' ? t('tryOn.modeAutoHint') : t('tryOn.modePaintHint')}
          </span>
        </div>

        {session.mode === 'paint' && (
          <>
          <div className="viewport__group"><button className="tool" disabled={!session.canUndo} onClick={session.undoStroke}>{t('extra.undo')}</button><button className="tool" disabled={!session.canRedo} onClick={session.redoStroke}>{t('extra.redo')}</button></div>
          <BrushControls
            radius={session.brush.radius}
            flow={session.brush.flow}
            hasTarget={Boolean(session.activePaint)}
            onChange={session.setBrush}
          />
          </>
        )}

        <nav className="studio__tabs" aria-label={t('studio.panels')}>
          {(['products', 'applied', 'looks'] as const).map(value => <button type="button" key={value} className="studio__tab" aria-pressed={panel === value} onClick={() => setPanel(value)}>{t(`studio.${value}`)}{value === 'applied' && entries.length > 0 && <span>{entries.length}</span>}</button>)}
        </nav>
        <div className="studio__panel" hidden={panel !== 'applied'}>
        <AppliedList
          entries={entries}
          onIntensity={session.setIntensity}
          onRemove={session.remove}
          onActivate={session.setActivePaintProductId}
          onClearAll={session.clearAll}
        />

        </div>
        <div className="studio__panel" hidden={panel !== 'looks'}>
        <LooksPanel
          uid={uid}
          revision={looksRevision}
          canSave={entries.length > 0}
          onSave={handleSave}
          onApply={handleApply}
        />

        </div>
        <div className="studio__panel" hidden={panel !== 'products'}>
          <CatalogPanel selectedId={selectedId} onSelect={product => { setSelectedId(product.id); session.selectProduct(product) }} />
        </div>
        <p className="studio__privacy">{t('face.privacy')}</p>
        </aside>
      </div>
    </div>
  )
}

/** Rebuilds a paint layer by replaying the saved strokes into it. */
function buildPaint(product: Product, entry: Look['painted'][number], layers: Map<string, PaintLayer>) {
  let layer = layers.get(product.id)
  if (!layer) {
    layer = new PaintLayer()
    layers.set(product.id, layer)
  }
  layer.clear()
  for (const stroke of entry.strokes) layer.replay(stroke)
  return { product, intensity: entry.intensity, layer, strokes: entry.strokes }
}
