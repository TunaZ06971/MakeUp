import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { AppLanguage } from '../types/models'
import en from './locales/en.json'
import zh from './locales/zh.json'

const STORAGE_KEY = 'makeup.language'

export function detectLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function setLanguage(language: AppLanguage) {
  localStorage.setItem(STORAGE_KEY, language)
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en'
  return i18n.changeLanguage(language)
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

document.documentElement.lang = i18n.language === 'zh' ? 'zh-Hans' : 'en'

export default i18n
