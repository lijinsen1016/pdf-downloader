import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '../shared/types';

type TokenMap = Record<string, string>;

/** 仅用于读取旧版本（0.3.x）写入的会话 token，新记录统一走 auth-header-repo。 */
export async function loadTokens(): Promise<TokenMap> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.bearerTokens);
  const value = raw[STORAGE_KEYS.bearerTokens];
  if (!value || typeof value !== 'object') return {};
  return value as TokenMap;
}

export async function deleteTokens(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const tokens = await loadTokens();
  let changed = false;
  for (const id of recordIds) {
    if (id in tokens) {
      delete tokens[id];
      changed = true;
    }
  }
  if (!changed) return;
  await browser.storage.session.set({ [STORAGE_KEYS.bearerTokens]: tokens });
}

export async function clearTokens(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.bearerTokens);
}
