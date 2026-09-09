import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteLook, listLooks, type Look } from '../../lib/firestore/looks'

interface LooksPanelProps {
  uid: string | undefined
  /** Bumped by the parent after a save so the list refreshes. */
  revision: number
  canSave: boolean
  onSave: (title: string) => Promise<void>
  onApply: (look: Look) => Promise<void>
}

export function LooksPanel({ uid, revision, canSave, onSave, onApply }: LooksPanelProps) {
  const { t } = useTranslation()
  const [looks, setLooks] = useState<Look[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!uid) return
    let cancelled = false
    listLooks(uid)
      .then((loaded) => {
        if (!cancelled) setLooks(loaded)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => {
      cancelled = true
    }
  }, [uid, revision])

  async function handleSave() {
    if (!canSave || busy) return
    setBusy(true)
    setError(false)
    try {
      await onSave(title.trim() || t('looks.untitled'))
      setTitle('')
    } catch { setError(true) } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true); setError(false)
    try { await deleteLook(id); setLooks(previous => previous.filter(look => look.id !== id)) }
    catch { setError(true) } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h2 className="card__title">{t('looks.title')}</h2>

      {error && <p className="form__error" role="alert">{t('errors.looks')}</p>}
      <div className="looks__save">
        <input
          className="field__input"
          type="text"
          placeholder={t('looks.namePlaceholder')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button className="button" type="button" disabled={!canSave || busy} onClick={handleSave}>
          {t('looks.save')}
        </button>
      </div>

      {!looks.length && <p className="catalog__status">{t('looks.empty')}</p>}

      {looks.length > 0 && (
        <ul className="applied__list">
          {looks.map((look) => (
            <li key={look.id} className="applied__item">
              <button type="button" className="applied__identity" disabled={busy} onClick={async () => { setBusy(true); setError(false); try { await onApply(look) } catch { setError(true) } finally { setBusy(false) } }}>
                <span className="applied__name">{look.title}</span>
              </button>
              <span className="looks__count">
                {t('looks.itemCount', {
                  count: look.applied.length + look.painted.length,
                })}
              </span>
              <button
                type="button"
                className="view__remove"
                aria-label={t('looks.delete')}
                disabled={busy}
                onClick={() => handleDelete(look.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
