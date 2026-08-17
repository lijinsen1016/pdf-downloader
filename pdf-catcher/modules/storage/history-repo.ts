import { browser } from 'wxt/browser';
import { MAX_HISTORY_ITEMS, STORAGE_KEYS, type DownloadHistoryItem } from '../shared/types';
import { historyItemSchema } from '../protocol/schemas';

export async function loadHistory(): Promise<DownloadHistoryItem[]> {
  const raw = await browser.storage.local.get(STORAGE_KEYS.history);
  const value = raw[STORAGE_KEYS.history];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => historyItemSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as DownloadHistoryItem)
    .slice(0, MAX_HISTORY_ITEMS);
}

export async function addHistoryItem(item: DownloadHistoryItem): Promise<DownloadHistoryItem[]> {
  const history = [item, ...(await loadHistory())].slice(0, MAX_HISTORY_ITEMS);
  await browser.storage.local.set({ [STORAGE_KEYS.history]: history });
  return history;
}

export async function deleteHistoryItem(id: string): Promise<DownloadHistoryItem[]> {
  const history = (await loadHistory()).filter((item) => item.id !== id);
  await browser.storage.local.set({ [STORAGE_KEYS.history]: history });
  return history;
}

export async function clearHistory(): Promise<DownloadHistoryItem[]> {
  await browser.storage.local.remove(STORAGE_KEYS.history);
  return [];
}
