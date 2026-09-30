import { browser } from 'wxt/browser';
import type { DownloadJob, PdfRecord } from '../shared/types';
import type { StoredPostBody } from '../storage/post-body-repo';
import type { BlobLeaseManager } from './blob-leases';
import { fetchBlobInOffscreen, revokeBlobInOffscreen } from './offscreen-client';

export interface TransportContext {
  getJob: (jobId: string) => DownloadJob | undefined;
  updateJob: (jobId: string, patch: Partial<DownloadJob>) => void;
  releaseBlob: (jobId: string) => void;
  leases: BlobLeaseManager;
}

export function downloadTargetUrl(record: PdfRecord): string {
  return record.finalUrl ?? record.url;
}

/** 无凭证场景：交给浏览器直接下载原始 URL。 */
export async function runDirectDownload(
  ctx: TransportContext,
  job: DownloadJob,
  record: PdfRecord
): Promise<void> {
  ctx.updateJob(job.id, { status: 'starting', errorKey: undefined, errorDetail: undefined });
  const downloadId = await browser.downloads.download({
    url: downloadTargetUrl(record),
    filename: record.fileName,
    conflictAction: 'uniquify',
    saveAs: false
  });

  if (ctx.getJob(job.id)?.status === 'canceled') {
    await browser.downloads.cancel(downloadId);
    return;
  }
  ctx.updateJob(job.id, { status: 'downloading', downloadId });
}

export interface OffscreenOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  postBody?: StoredPostBody;
  /** 置信度来自 URL 后缀推断时，要求响应体真的是 PDF。 */
  requirePdfMagic?: boolean;
}

/**
 * 需要携带 Cookie / 自定义鉴权头、或需要重放 POST body 时，
 * 先在离屏文档取回 blob，再交给 chrome.downloads。
 */
export async function runOffscreenDownload(
  ctx: TransportContext,
  job: DownloadJob,
  record: PdfRecord,
  options: OffscreenOptions = {}
): Promise<void> {
  ctx.updateJob(job.id, { status: 'fetching', errorKey: undefined, errorDetail: undefined });

  const blob = await fetchBlobInOffscreen({
    jobId: job.id,
    url: downloadTargetUrl(record),
    headers: options.headers,
    method: options.method,
    postBody: options.postBody,
    requirePdfMagic: options.requirePdfMagic
  });

  if (ctx.getJob(job.id)?.status === 'canceled') {
    await revokeBlobInOffscreen(blob.blobUrl);
    return;
  }

  ctx.leases.add(blob.blobUrl);
  try {
    ctx.updateJob(job.id, { status: 'starting', blobUrl: blob.blobUrl });
    const downloadId = await browser.downloads.download({
      url: blob.blobUrl,
      filename: record.fileName,
      conflictAction: 'uniquify',
      saveAs: false
    });

    if (ctx.getJob(job.id)?.status === 'canceled') {
      ctx.releaseBlob(job.id);
      await browser.downloads.cancel(downloadId);
      return;
    }

    ctx.updateJob(job.id, { status: 'downloading', downloadId });
  } catch (error) {
    ctx.releaseBlob(job.id);
    throw error;
  }
}
