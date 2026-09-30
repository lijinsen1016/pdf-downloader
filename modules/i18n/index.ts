import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import en from './locales/en';
import type { Language } from '../shared/types';

const STORAGE_KEY = 'pdf-catcher:language';

function getInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh-CN' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLanguage(),
  fallbackLocale: 'en',
  messages: {
    'zh-CN': zhCN,
    en
  }
});

export function setLanguage(language: Language): void {
  i18n.global.locale.value = language;
  localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
}
