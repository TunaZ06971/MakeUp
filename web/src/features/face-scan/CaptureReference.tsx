import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FaceScan } from './scanModel'
export function CaptureReference({ scan, images }: { scan: FaceScan; images?: HTMLCanvasElement[] }) {
  const { t } = useTranslation(), [index, setIndex] = useState(0), [original, setOriginal] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = scan.frames[Math.min(index, scan.frames.length - 1)]
  useEffect(() => {
    const source = images?.[index], target = canvas.current
    if (!source || !target) return
    target.width = source.width; target.height = source.height
    target.getContext('2d')!.drawImage(source, 0, 0)
  }, [images, index, original])
  return <div className="capture-reference">
    <div className="viewport__group">
      {scan.frames.map((f, i) => <button key={`${f.step}-${i}`} className="tool" aria-pressed={index === i} onClick={() => setIndex(i)}>{t(`scan.short.${f.step}`)}</button>)}
    </div>
    <button className="tool" aria-pressed={original} onClick={() => setOriginal(!original)}>{t(original ? 'scan.showMakeupReference' : 'scan.showOriginalReference')}</button>
    <div className="capture-reference__image">{original || !images ? <img src={frame.image} alt={t('scan.originalReference')} /> : <canvas ref={canvas} aria-label={t('scan.makeupReference')} />}</div>
    <p className="scan-footnote">{t('scan.referenceNotice')}</p>
  </div>
}
