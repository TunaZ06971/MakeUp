import { useTranslation } from 'react-i18next'

interface BrushControlsProps {
  radius: number
  flow: number
  onChange: (next: { radius: number; flow: number }) => void
  hasTarget: boolean
}

export function BrushControls({ radius, flow, onChange, hasTarget }: BrushControlsProps) {
  const { t } = useTranslation()

  return (
    <section className="card brush">
      <h2 className="card__title">{t('tryOn.brush')}</h2>
      {!hasTarget && <p className="catalog__status">{t('tryOn.pickBrushProduct')}</p>}

      <label className="brush__row">
        <span>{t('tryOn.brushSize')}</span>
        <input
          className="intensity__slider"
          type="range"
          min={0.008}
          max={0.08}
          step={0.002}
          value={radius}
          onChange={(event) => onChange({ radius: Number(event.target.value), flow })}
        />
      </label>

      <label className="brush__row">
        <span>{t('tryOn.brushFlow')}</span>
        <input
          className="intensity__slider"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={flow}
          onChange={(event) => onChange({ radius, flow: Number(event.target.value) })}
        />
      </label>
    </section>
  )
}
