import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuthShell } from './AuthShell'
import { authErrorKey, resetPassword } from './authActions'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorKey(null)
    setBusy(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (error) {
      setErrorKey(authErrorKey(error))
    }
    setBusy(false)
  }

  return (
    <AuthShell
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
      footer={<Link to="/login">{t('auth.reset.backToLogin')}</Link>}
    >
      {sent ? (
        <p className="form__notice">{t('auth.reset.sent', { email })}</p>
      ) : (
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

          {errorKey && <p className="form__error">{t(errorKey)}</p>}

          <button className="button" type="submit" disabled={busy}>
            {busy ? t('auth.working') : t('auth.reset.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
