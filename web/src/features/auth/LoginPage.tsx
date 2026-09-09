import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import type { AppLanguage } from '../../types/models'
import { AuthShell } from './AuthShell'
import { authErrorKey, signIn } from './authActions'
import { useAuth } from './authContext'

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorKey(null)
    setBusy(true)
    try {
      await signIn(email, password, i18n.language as AppLanguage)
    } catch (error) {
      setErrorKey(authErrorKey(error))
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('app.tagline')}
      footer={
        <>
          {t('auth.login.noAccount')} <Link to="/signup">{t('auth.login.signupLink')}</Link>
        </>
      }
    >
      <Link className="capture-entry" to="/capture">{t('capture.entry')} →</Link>
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">{t('auth.email')}</span>
          <input
            className="field__input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">{t('auth.password')}</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {errorKey && <p className="form__error">{t(errorKey)}</p>}

        <button className="button" type="submit" disabled={busy}>
          {busy ? t('auth.working') : t('auth.login.submit')}
        </button>

        <Link className="form__link" to="/forgot-password">
          {t('auth.login.forgot')}
        </Link>
      </form>
    </AuthShell>
  )
}
