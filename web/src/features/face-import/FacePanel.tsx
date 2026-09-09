import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaintLayer, StrokePoint } from '../render-engine/paintLayer'
import { TryOnCanvas, type BrushSettings, type TryOnLayer } from '../render-engine/TryOnCanvas'
import type { FaceView } from './usePhotoLibrary'

interface FacePanelProps {
  views: FaceView[]
  active: FaceView | null
  loading: boolean
  error?: boolean
  layers: TryOnLayer[]
  brush?: { target: PaintLayer; settings: BrushSettings } | null
  onSelectView: (id: string) => void
  onAddPhotos: (files: File[]) => void
  onRemovePhoto: (id: string) => void
  onStroke?: (points: StrokePoint[]) => void
}

export function FacePanel({
  views,
  active,
  loading,
  error,
  layers,
  brush = null,
  onSelectView,
  onAddPhotos,
  onRemovePhoto,
  onStroke,
}: FacePanelProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="card face-panel">
      <div className="face__header">
        <h2 className="card__title">{t('face.title')}</h2>
        <button className="button" type="button" disabled={loading} onClick={() => fileInputRef.current?.click()}>
          {views.length ? t('face.addView') : t('face.import')}
        </button>
      </div>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length) onAddPhotos(files)
        }}
      />

      {error && <p className="form__error" role="alert">{t('errors.photos')}</p>}
      {loading && <p className="face__status">{t('face.status.detecting')}</p>}

      {!loading && !views.length && (
        <div className="face__empty">
          <p>{t('face.empty')}</p>
          <p className="face__privacy">{t('face.privacy')}</p>
        </div>
      )}

      {active && (
        <>
          <div className="preview">
            {/* No key: switching angles swaps the photo and mesh inside one
                renderer rather than tearing down the WebGL context each time. */}
            <TryOnCanvas
              bitmap={active.bitmap}
              detection={active.detection}
              layers={layers}
              brush={brush}
              onStrokeChange={onStroke}
            />
          </div>

          {active.status !== 'detected' && (
            <p className="face__status">
              {active.status === 'detecting' && t('face.status.detecting')}
              {active.status === 'noFace' && t('face.status.noFace')}
              {active.status === 'failed' && t('face.status.failed')}
            </p>
          )}
        </>
      )}

      {views.length > 0 && (
        <div className="views">
          {views.map((view, index) => (
            <div
              key={view.record.id}
              className={`view${view.record.id === active?.record.id ? ' view--active' : ''}`}
            >
              <button
                type="button"
                className="view__button"
                onClick={() => onSelectView(view.record.id)}
                aria-pressed={view.record.id === active?.record.id}
              >
                <img src={view.thumbnailUrl} alt={t('face.viewNumber', { number: index + 1 })} />
                {view.status === 'noFace' && <span className="view__warning">!</span>}
              </button>
              <button
                type="button"
                className="view__remove"
                aria-label={t('face.removeView')}
                onClick={() => onRemovePhoto(view.record.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {views.length === 1 && (
        <p className="face__hint">{t('face.multiViewHint')}</p>
      )}
    </section>
  )
}
