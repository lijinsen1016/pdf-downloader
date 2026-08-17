import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, STORAGE_KEYS, type Settings } from '../shared/types';
import { settingsSchema } from '../protocol/schemas';

export async function getSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get(STORAGE_KEYS.settings);
  const parsed = settingsSchema.safeParse(raw[STORAGE_KEYS.settings]);
  return {
    ...DEFAULT_SETTINGS,
    ...(parsed.success ? parsed.data : {})
  };
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
