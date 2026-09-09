import { useTranslation } from 'react-i18next'
import { setLanguage } from '../i18n'
import type { AppLanguage } from '../types/models'

const LANGUAGES: AppLanguage[] = ['zh', 'en']

export function LanguageToggle() {
  const { t, i18n } = useTranslation()

  return (
    <div className="lang" role="group" aria-label={t('language.label')}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className="lang__button"
          aria-pressed={i18n.language === code}
          onClick={() => setLanguage(code)}
        >
          {t(`language.${code}`)}
        </button>
      ))}
    </div>
  )
}
