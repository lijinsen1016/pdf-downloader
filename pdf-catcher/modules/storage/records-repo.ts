import { browser } from 'wxt/browser';
import { STORAGE_KEYS, type PdfRecord, type Settings } from '../shared/types';
import { pdfRecordSchema } from '../protocol/schemas';

export async function loadRecords(): Promise<PdfRecord[]> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.records);
  const value = raw[STORAGE_KEYS.records];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => pdfRecordSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as PdfRecord);
}

export function trimRecords(records: PdfRecord[], settings: Settings): PdfRecord[] {
  const cutoff = Date.now() - settings.retentionMinutes * 60 * 1000;
  return records
    .filter((record) => record.capturedAt >= cutoff)
    .slice(0, settings.maxRecords);
}

export async function saveRecords(records: PdfRecord[]): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEYS.records]: records });
}

export async function clearRecords(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.records);
}
