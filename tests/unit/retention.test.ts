import { describe, expect, it } from 'vitest';
import { splitRecordsByRetention } from '@/modules/storage/retention';
import { DEFAULT_SETTINGS, type PdfRecord, type Settings } from '@/modules/shared/types';

const NOW = 1_700_000_000_000;

function record(id: string, capturedAt: number): PdfRecord {
  return {
    id,
    url: `https://example.com/${id}.pdf`,
    host: 'example.com',
    fileName: `${id}.pdf`,
    capturedAt,
    statusCode: 200,
    confidence: 'high',
    auth: { cookie: false, authHeaders: [] },
    source: 'network',
    method: 'GET'
  };
}

const settings: Settings = { ...DEFAULT_SETTINGS, retentionMinutes: 30, maxRecords: 3 };

describe('splitRecordsByRetention', () => {
  it('keeps records inside the retention window', () => {
    const records = [record('a', NOW - 1000), record('b', NOW - 60_000)];
    const { kept, dropped } = splitRecordsByRetention(records, settings, NOW);
    expect(kept.map((item) => item.id)).toEqual(['a', 'b']);
    expect(dropped).toEqual([]);
  });

  it('reports expired records as dropped so callers can clean session credentials', () => {
    const records = [record('fresh', NOW - 1000), record('stale', NOW - 31 * 60_000)];
    const { kept, dropped } = splitRecordsByRetention(records, settings, NOW);
    expect(kept.map((item) => item.id)).toEqual(['fresh']);
    expect(dropped.map((item) => item.id)).toEqual(['stale']);
  });

  it('drops the oldest records beyond maxRecords', () => {
    const records = [
      record('newest', NOW - 1000),
      record('second', NOW - 2000),
      record('third', NOW - 3000),
      record('oldest', NOW - 4000)
    ];
    const { kept, dropped } = splitRecordsByRetention(records, settings, NOW);
    expect(kept.map((item) => item.id)).toEqual(['newest', 'second', 'third']);
    expect(dropped.map((item) => item.id)).toEqual(['oldest']);
  });
});
