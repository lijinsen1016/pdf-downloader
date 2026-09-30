import type { Language } from './types';

/**
 * 依据浏览器语言推断界面语言。传入参数便于单测；缺省读取 navigator.language。
 */
export function detectLanguage(navigatorLanguage?: string): Language {
  const value = (
    navigatorLanguage ??
    (typeof navigator === 'undefined' ? '' : navigator.language) ??
    ''
  )
    .trim()
    .toLowerCase();

  return value.startsWith('zh') ? 'zh-CN' : 'en';
}
