import { browser } from 'wxt/browser';
import type { DownloadJob, PdfRecord } from '../shared/types';
import type { StoredPostBody } from '../storage/post-body-repo';
import type { BlobLeaseManager } from './blob-leases';
import { fetchBlobInOffscreen, revokeBlobInOffscreen } from './offscreen-client';

export interface TransportContext {
  getJob: (jobId: string) => DownloadJob | undefined;
  updateJob: (jobId: string, patch: Partial<DownloadJob>) => void;
  leases: BlobLeaseManager;
}

/**
 * 任务被取消，或记录/任务已被清理时都必须中止：
 * 只看 `status === 'canceled'` 会在任务被删除后失手，导致下载在记录消失后静默跑完。
 */
function isAborted(ctx: TransportContext, jobId: string): boolean {
  const job = ctx.getJob(jobId);
  return !job || job.status === 'canceled';
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

  if (isAborted(ctx, job.id)) {
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

  if (isAborted(ctx, job.id)) {
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

    if (isAborted(ctx, job.id)) {
      ctx.updateJob(job.id, { blobUrl: undefined });
      ctx.leases.release(blob.blobUrl);
      await browser.downloads.cancel(downloadId);
      return;
    }

    ctx.updateJob(job.id, { status: 'downloading', downloadId });
  } catch (error) {
    // 任务可能已被删除，租约必须按 URL 释放，不能依赖任务对象还在
    ctx.updateJob(job.id, { blobUrl: undefined });
    ctx.leases.release(blob.blobUrl);
    throw error;
  }
}
