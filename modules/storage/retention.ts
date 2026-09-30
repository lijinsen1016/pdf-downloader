import type { PdfRecord, Settings } from '../shared/types';

export interface RetentionSplit {
  kept: PdfRecord[];
  dropped: PdfRecord[];
}

/**
 * 按保留时长与数量上限切分记录（纯函数，便于单测）。
 * 调用方必须同时处理 dropped，否则这些记录对应的会话凭证会残留在 storage.session。
 */
export function splitRecordsByRetention(
  records: PdfRecord[],
  settings: Settings,
  now = Date.now()
): RetentionSplit {
  const cutoff = now - settings.retentionMinutes * 60 * 1000;
  const kept = records.filter((record) => record.capturedAt >= cutoff).slice(0, settings.maxRecords);
  const keptIds = new Set(kept.map((record) => record.id));
  const dropped = records.filter((record) => !keptIds.has(record.id));
  return { kept, dropped };
}
