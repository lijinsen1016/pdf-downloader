import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, STORAGE_KEYS, type Settings } from '../shared/types';
import { detectLanguage } from '../shared/language';
import { settingsSchema } from '../protocol/schemas';

/**
 * 未保存过设置时，界面语言跟随浏览器语言，而不是固定落到 DEFAULT_SETTINGS.language。
 */
export async function getSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get(STORAGE_KEYS.settings);
  const stored = raw[STORAGE_KEYS.settings];
  const parsed = settingsSchema.safeParse(stored);
  const base: Settings = { ...DEFAULT_SETTINGS, language: detectLanguage() };

  if (parsed.success) {
    // 旧版本可能把默认值 zh-CN 写进了存储；只要用户没有显式选择过，
    // 就继续跟随浏览器语言（settingsSchema 的 default 无法区分这两种情况）。
    const hasStoredLanguage =
      typeof stored === 'object' && stored !== null && 'language' in (stored as object);
    return {
      ...base,
      ...parsed.data,
      language: hasStoredLanguage ? parsed.data.language : base.language
    };
  }

  return base;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  const parsed = settingsSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error('settings validation failed');
  }
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: parsed.data });
  return parsed.data;
}

export function subscribeSettings(callback: (settings: Settings) => void): () => void {
  const listener = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string
  ) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.settings]) return;
    callback(await getSettings());
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
