import { browser } from 'wxt/browser';
import { MAX_STORED_AUTH_HEADER_SETS, STORAGE_KEYS } from '../shared/types';

export type AuthHeaderMap = Record<string, Record<string, string>>;

export async function loadAuthHeaders(): Promise<AuthHeaderMap> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.authHeaders);
  const value = raw[STORAGE_KEYS.authHeaders];
  if (!value || typeof value !== 'object') return {};
  return value as AuthHeaderMap;
}

/** 只保留最近的 N 组会话凭证，超出部分按插入顺序淘汰。 */
function capEntries(all: AuthHeaderMap, limit: number): AuthHeaderMap {
  const ids = Object.keys(all);
  if (ids.length <= limit) return all;
  const kept: AuthHeaderMap = {};
  for (const id of ids.slice(ids.length - limit)) {
    const value = all[id];
    if (value) kept[id] = value;
  }
  return kept;
}

async function writeAll(all: AuthHeaderMap): Promise<void> {
  const next = capEntries(all, MAX_STORED_AUTH_HEADER_SETS);
  try {
    await browser.storage.session.set({ [STORAGE_KEYS.authHeaders]: next });
  } catch (error) {
    console.warn('[pdf-catcher] auth header quota exceeded, dropping oldest entries', error);
    const retry = capEntries(all, Math.floor(MAX_STORED_AUTH_HEADER_SETS / 2));
    await browser.storage.session.set({ [STORAGE_KEYS.authHeaders]: retry });
  }
}

export async function saveAuthHeaders(recordId: string, headers: Record<string, string>): Promise<void> {
  const all = await loadAuthHeaders();
  all[recordId] = headers;
  await writeAll(all);
}

export async function deleteAuthHeaders(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const all = await loadAuthHeaders();
  for (const id of recordIds) delete all[id];
  await writeAll(all);
}

export async function clearAuthHeaders(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.authHeaders);
}
