import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '../shared/types';

export type AuthHeaderMap = Record<string, Record<string, string>>;

export async function loadAuthHeaders(): Promise<AuthHeaderMap> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.authHeaders);
  const value = raw[STORAGE_KEYS.authHeaders];
  if (!value || typeof value !== 'object') return {};
  return value as AuthHeaderMap;
}

export async function saveAuthHeaders(recordId: string, headers: Record<string, string>): Promise<void> {
  const all = await loadAuthHeaders();
  all[recordId] = headers;
  await browser.storage.session.set({ [STORAGE_KEYS.authHeaders]: all });
}

export async function deleteAuthHeaders(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const all = await loadAuthHeaders();
  for (const id of recordIds) delete all[id];
  await browser.storage.session.set({ [STORAGE_KEYS.authHeaders]: all });
}

export async function clearAuthHeaders(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.authHeaders);
}
