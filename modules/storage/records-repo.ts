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

export async function saveRecords(records: PdfRecord[]): Promise<void> {
  try {
    await browser.storage.session.set({ [STORAGE_KEYS.records]: records });
  } catch (error) {
    // 配额打满时退化为只保留最近一半记录，避免整个捕获管线因为写入失败而中断。
    const fallback = records.slice(0, Math.max(10, Math.floor(records.length / 2)));
    console.warn('[pdf-catcher] failed to persist records, falling back to', fallback.length, error);
    await browser.storage.session.set({ [STORAGE_KEYS.records]: fallback });
  }
}

export async function clearRecords(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.records);
}
