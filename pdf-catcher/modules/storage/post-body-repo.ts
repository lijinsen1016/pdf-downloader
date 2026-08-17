import { browser } from 'wxt/browser';
import { STORAGE_KEYS } from '../shared/types';

export interface StoredPostBody {
  contentType?: string;
  kind: 'form' | 'raw';
  formData?: Record<string, string[]>;
  base64?: string;
}

export async function loadPostBody(recordId: string): Promise<StoredPostBody | undefined> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.postBodies);
  const all = (raw[STORAGE_KEYS.postBodies] ?? {}) as Record<string, StoredPostBody>;
  return all[recordId];
}

export async function savePostBody(recordId: string, body: StoredPostBody): Promise<void> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.postBodies);
  const all = (raw[STORAGE_KEYS.postBodies] ?? {}) as Record<string, StoredPostBody>;
  all[recordId] = body;
  await browser.storage.session.set({ [STORAGE_KEYS.postBodies]: all });
}

export async function deletePostBodies(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const raw = await browser.storage.session.get(STORAGE_KEYS.postBodies);
  const all = (raw[STORAGE_KEYS.postBodies] ?? {}) as Record<string, StoredPostBody>;
  for (const id of recordIds) delete all[id];
  await browser.storage.session.set({ [STORAGE_KEYS.postBodies]: all });
}

export async function clearPostBodies(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.postBodies);
}
