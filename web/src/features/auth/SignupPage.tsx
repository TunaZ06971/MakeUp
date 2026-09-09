import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import type { AppLanguage } from '../../types/models'
import { AuthShell } from './AuthShell'
import { authErrorKey, signUp } from './authActions'
import { useAuth } from './authContext'

export function SignupPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Firebase signs the user in the moment the account exists, but the display
  // name is only attached a moment later — hold the redirect until then.
  if (user && !busy) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorKey(null)
    setBusy(true)
    try {
      await signUp(email, password, displayName.trim(), i18n.language as AppLanguage)
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
    setBusy(false)
  }

  return (
    <AuthShell
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      footer={
        <>
          {t('auth.signup.haveAccount')} <Link to="/login">{t('auth.signup.loginLink')}</Link>
        </>
      }
    >
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">{t('auth.displayName')}</span>
          <input
            className="field__input"
            type="text"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

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
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="field__hint">{t('auth.passwordHint')}</span>
        </label>

        {errorKey && <p className="form__error">{t(errorKey)}</p>}

        <button className="button" type="submit" disabled={busy}>
          {busy ? t('auth.working') : t('auth.signup.submit')}
        </button>
      </form>
    </AuthShell>
  )
}
