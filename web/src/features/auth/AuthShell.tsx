import { LocalStatus } from '../../components/LocalStatus'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageToggle } from '../../components/LanguageToggle'

interface AuthShellProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  const { t } = useTranslation()

  return (
    <div className="auth">
      <div className="auth__top">
        <span className="auth__brand">{t('app.name')}</span>
        <LanguageToggle />
      </div>

      <div className="auth__card">
        <h1 className="auth__title">{title}</h1>
        {subtitle && <p className="auth__subtitle">{subtitle}</p>}
        {children}
      </div>

      <LocalStatus />
      {footer && <div className="auth__footer">{footer}</div>}
    </div>
  )
}
