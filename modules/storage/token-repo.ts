import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '../shared/types';

type TokenMap = Record<string, string>;

export async function loadTokens(): Promise<TokenMap> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.bearerTokens);
  const value = raw[STORAGE_KEYS.bearerTokens];
  if (!value || typeof value !== 'object') return {};
  return value as TokenMap;
}

export async function saveToken(recordId: string, token: string): Promise<void> {
  const tokens = await loadTokens();
  tokens[recordId] = token;
  await browser.storage.session.set({ [STORAGE_KEYS.bearerTokens]: tokens });
}

export async function deleteTokens(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const tokens = await loadTokens();
  for (const id of recordIds) delete tokens[id];
  await browser.storage.session.set({ [STORAGE_KEYS.bearerTokens]: tokens });
}

export async function clearTokens(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.bearerTokens);
}
