import { useTranslation } from 'react-i18next'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from './authContext'

export function RequireAuth() {
  const { t } = useTranslation()
  const { user, ready } = useAuth()

  if (!ready) return <p className="loading">{t('status.connecting')}</p>
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}
