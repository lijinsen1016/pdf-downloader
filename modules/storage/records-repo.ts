import { browser } from 'wxt/browser';
import { STORAGE_KEYS, type PdfRecord } from '../shared/types';
import { pdfRecordSchema } from '../protocol/schemas';

export { splitRecordsByRetention, type RetentionSplit } from './retention';

export async function loadRecords(): Promise<PdfRecord[]> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.records);
  const value = raw[STORAGE_KEYS.records];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => pdfRecordSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as PdfRecord);
}

/**
 * 写入记录。配额打满时退化为只保留最近一半，并**返回被丢弃的记录**，
 * 由调用方清理它们对应的会话凭证，避免凭证成为孤儿。
 */
export async function saveRecords(records: PdfRecord[]): Promise<PdfRecord[]> {
  try {
    await browser.storage.session.set({ [STORAGE_KEYS.records]: records });
    return [];
  } catch (error) {
    const keep = Math.max(10, Math.floor(records.length / 2));
    const fallback = records.slice(0, keep);
    console.warn('[pdf-catcher] failed to persist records, falling back to', fallback.length, error);
    await browser.storage.session.set({ [STORAGE_KEYS.records]: fallback });
    return records.slice(keep);
  }
}

export async function clearRecords(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.records);
}
