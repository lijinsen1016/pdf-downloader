import { describe, expect, it } from 'vitest';
import type { Browser } from 'wxt/browser';
import { applyDownloadDelta } from '@/modules/downloads/download-delta';
import type { DownloadJob } from '@/modules/shared/types';

function job(patch: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'job-1',
    recordId: 'record-1',
    url: 'https://example.com/a.pdf',
    fileName: 'a.pdf',
    status: 'downloading',
    createdAt: 0,
    updatedAt: 0,
    ...patch
  };
}

const delta = (
  value: Omit<Browser.downloads.DownloadDelta, 'id'>
): Browser.downloads.DownloadDelta => ({ id: 1, ...value });

describe('applyDownloadDelta', () => {
  it('adopts fileSize from the same delta that reports completion', () => {
    const result = applyDownloadDelta(
      job(),
      delta({ state: { current: 'complete' }, fileSize: { current: 2048 } })
    );

    expect(result.patch).toMatchObject({
      status: 'done',
      receivedBytes: 2048,
      totalBytes: 2048
    });
    expect(result.completed).toBe(true);
    expect(result.releaseLease).toBe(true);
  });

  it('falls back to totalBytes when fileSize is absent', () => {
    const result = applyDownloadDelta(
      job(),
      delta({ state: { current: 'complete' }, totalBytes: { current: 4096 } })
    );
    expect(result.patch.receivedBytes).toBe(4096);
  });

  it('ignores an unknown file size reported as -1', () => {
    const result = applyDownloadDelta(
      job(),
      delta({ state: { current: 'complete' }, totalBytes: { current: 4096 }, fileSize: { current: -1 } })
    );
    expect(result.patch).toMatchObject({ status: 'done', totalBytes: 4096, receivedBytes: 4096 });
  });

  it('marks interrupted jobs as failed with a translatable error key', () => {
    const result = applyDownloadDelta(job(), delta({ state: { current: 'interrupted' } }));
    expect(result.patch).toMatchObject({
      status: 'failed',
      errorKey: 'message.downloadInterrupted'
    });
    expect(result.releaseLease).toBe(true);
    expect(result.completed).toBe(false);
  });

  it('keeps canceled jobs canceled without an error key', () => {
    const result = applyDownloadDelta(
      job({ status: 'canceled' }),
      delta({ state: { current: 'interrupted' } })
    );
    expect(result.patch.status).toBe('canceled');
    expect(result.patch.errorKey).toBeUndefined();
  });

  it('only updates progress when no state change is reported', () => {
    const result = applyDownloadDelta(job(), delta({ totalBytes: { current: 100 } }));
    expect(result.patch).toEqual({ totalBytes: 100 });
    expect(result.completed).toBe(false);
    expect(result.releaseLease).toBe(false);
  });
});
