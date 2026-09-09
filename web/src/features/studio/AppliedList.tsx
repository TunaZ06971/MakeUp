import { useTranslation } from 'react-i18next'
import type { Product } from '../../types/models'

export interface AppliedEntry {
  key: string
  product: Product
  intensity: number
  /** Paint entries can be made the active brush target. */
  paintable: boolean
  active: boolean
}

interface AppliedListProps {
  entries: AppliedEntry[]
  onIntensity: (key: string, value: number) => void
  onRemove: (key: string) => void
  onActivate: (key: string) => void
  onClearAll: () => void
}

export function AppliedList({
  entries,
  onIntensity,
  onRemove,
  onActivate,
  onClearAll,
}: AppliedListProps) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language === 'zh'
  if (!entries.length) return null

  return (
    <section className="card applied">
      <div className="face__header">
        <h2 className="card__title">{t('tryOn.applied')}</h2>
        <button className="button button--ghost" type="button" onClick={onClearAll}>
          {t('tryOn.clearAll')}
        </button>
      </div>

      <ul className="applied__list">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`applied__item${entry.active ? ' applied__item--active' : ''}`}
          >
            <button
              type="button"
              className="applied__identity"
              onClick={() => entry.paintable && onActivate(entry.key)}
              aria-pressed={entry.active}
              disabled={!entry.paintable}
            >
              <span
                className="product__swatch product__swatch--small"
                style={{ background: entry.product.colors[0]?.hex }}
              />
              <span className="applied__name">
                {(zh && entry.product.shadeNameZh) || entry.product.shadeName}
              </span>
            </button>

            <input
              className="intensity__slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={entry.intensity}
              aria-label={t('tryOn.intensity')}
              onChange={(event) => onIntensity(entry.key, Number(event.target.value))}
            />
            <span className="intensity__value">{Math.round(entry.intensity * 100)}%</span>

            <button
              type="button"
              className="view__remove"
              aria-label={t('tryOn.clear')}
              onClick={() => onRemove(entry.key)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
