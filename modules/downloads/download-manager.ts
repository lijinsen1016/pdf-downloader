import { browser, type Browser } from 'wxt/browser';
import {
  OFFSCREEN_BLOB_LEASE_MS,
  type DownloadJob,
  type PdfRecord,
  type Settings
} from '../shared/types';
import type { PortEvent } from '../protocol/schemas';
import { loadPostBody } from '../storage/post-body-repo';
import { openWithAuthorizationRule } from './auth-navigation';
import { BlobLeaseManager } from './blob-leases';
import { applyDownloadDelta } from './download-delta';
import { isActiveStatus, isTerminalStatus, JobQueue } from './job-queue';
import { fetchBlobInOffscreen, cancelFetchInOffscreen } from './offscreen-client';
import {
  runDirectDownload,
  runOffscreenDownload,
  type OffscreenOptions,
  type TransportContext
} from './transports';

export interface DownloadManagerDeps {
  getSettings: () => Settings;
  getRecords: () => PdfRecord[];
  getAuthHeaders: (record: PdfRecord) => Promise<Record<string, string>>;
  broadcast: (event: PortEvent) => void;
  onDownloadCompleted?: (job: DownloadJob) => void | Promise<void>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 下载编排层：决定每个记录走哪条传输路径（直连 / 离屏 / POST 重放），
 * 并处理取消、重启对账与阅读页打开。队列与持久化在 JobQueue，
 * 具体传输动作在 transports，blob 生命周期在 BlobLeaseManager。
 */
export class DownloadManager {
  private readonly queue: JobQueue;
  private readonly leases = new BlobLeaseManager();
  private readonly transportCtx: TransportContext;
  private initialized = false;

  constructor(private readonly deps: DownloadManagerDeps) {
    this.queue = new JobQueue({
      onJobReady: (job) => {
        void this.startJob(job).catch((error: unknown) => {
          this.failJob(job, 'message.downloadFailed', error);
        });
      },
      broadcast: deps.broadcast
    });
    this.transportCtx = {
      getJob: (jobId) => this.queue.find(jobId),
      updateJob: (jobId, patch) => this.queue.update(jobId, patch),
      releaseBlob: (jobId) => this.releaseBlob(jobId),
      leases: this.leases
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.queue.init();
    await this.reconcileAfterRestart();

    browser.downloads.onChanged.addListener(this.handleDownloadChanged);
    void this.queue.commit();
    this.queue.pump();
  }

  getJobs(): DownloadJob[] {
    return this.queue.list();
  }

  async startDownloads(recordIds: string[]): Promise<DownloadJob[]> {
    const records = this.deps.getRecords();
    const selected = recordIds
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is PdfRecord => Boolean(record));

    const added = this.queue.enqueue(selected);
    if (added > 0) {
      void this.queue.commit();
      this.queue.pump();
    }
    return this.queue.list().filter((job) => recordIds.includes(job.recordId));
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = this.queue.find(jobId);
    if (!job) return;

    if (job.status === 'fetching') {
      await cancelFetchInOffscreen(jobId);
      this.queue.update(jobId, { status: 'canceled' });
      return;
    }

    if (job.status === 'downloading' && job.downloadId !== undefined) {
      await browser.downloads.cancel(job.downloadId);
      this.queue.update(jobId, { status: 'canceled' });
      return;
    }

    // queued / starting：标记取消，由 startJob 在下一个检查点清理
    this.queue.update(jobId, { status: 'canceled' });
  }

  async cancelAll(): Promise<void> {
    for (const job of this.queue.list()) {
      if (!isActiveStatus(job.status)) continue;
      await this.cancelJob(job.id);
    }
  }

  /** 清空记录时使用：先停掉所有活动任务，再丢弃队列与已持久化的任务。 */
  async clearAllJobs(): Promise<void> {
    await this.cancelAll();
    await this.queue.clear();
  }

  /** 删除单条记录时使用：丢弃其任务，避免残留指向已删除记录。 */
  dropJobsForRecord(recordId: string): void {
    this.queue.removeJobsForRecord(recordId);
  }

  handleBlobLeaseExpired(blobUrl: string): void {
    this.leases.handleExpired(blobUrl);
  }

  async openRecord(
    recordId: string
  ): Promise<{ url: string; usedBlob: boolean; usedAuthRule?: boolean }> {
    const record = this.deps.getRecords().find((item) => item.id === recordId);
    if (!record) {
      throw new Error('record not found');
    }

    const targetUrl = record.finalUrl ?? record.url;
    const authHeaders = await this.deps.getAuthHeaders(record);

    if (record.method === 'POST') {
      const postBody = await loadPostBody(record.id);
      if (!postBody) {
        throw new Error('post body is no longer available');
      }
      try {
        const blob = await fetchBlobInOffscreen({
          jobId: `open-${crypto.randomUUID()}`,
          url: targetUrl,
          method: 'POST',
          postBody,
          headers: authHeaders,
          leaseMs: OFFSCREEN_BLOB_LEASE_MS
        });
        this.leases.add(blob.blobUrl);
        await browser.tabs.create({ url: blob.blobUrl, active: true });
        return { url: blob.blobUrl, usedBlob: true };
      } catch {
        // POST 阅读页失败时回退到原始 URL
      }
    }

    if (Object.keys(authHeaders).length > 0) {
      try {
        await openWithAuthorizationRule(targetUrl, authHeaders);
        return { url: targetUrl, usedBlob: false, usedAuthRule: true };
      } catch {
        // DNR 不可用时回退到 offscreen blob 阅读页
      }

      try {
        const blob = await fetchBlobInOffscreen({
          jobId: `open-${crypto.randomUUID()}`,
          url: targetUrl,
          headers: authHeaders,
          leaseMs: OFFSCREEN_BLOB_LEASE_MS
        });
        this.leases.add(blob.blobUrl);
        await browser.tabs.create({ url: blob.blobUrl, active: true });
        return { url: blob.blobUrl, usedBlob: true };
      } catch {
        // 最后回退到原始 URL
      }
    }

    await browser.tabs.create({ url: targetUrl, active: true });
    return { url: targetUrl, usedBlob: false };
  }

  private async startJob(job: DownloadJob): Promise<void> {
    const record = this.deps.getRecords().find((item) => item.id === job.recordId);
    if (!record) {
      this.queue.update(job.id, { status: 'failed', errorKey: 'message.recordNotFound' });
      return;
    }

    const authHeaders = await this.deps.getAuthHeaders(record);
    if (this.queue.isCanceled(job.id)) return;

    if (record.method === 'POST') {
      const postBody = await loadPostBody(record.id);
      if (this.queue.isCanceled(job.id)) return;
      if (!postBody) {
        this.queue.update(job.id, { status: 'failed', errorKey: 'message.postBodyMissing' });
        return;
      }
      await this.runOffscreenWithFallback(
        job,
        record,
        { method: 'POST', postBody, headers: authHeaders },
        false
      );
      return;
    }

    const hasAuthHeaders = Object.keys(authHeaders).length > 0;
    const needsMagicCheck = record.confidence === 'medium';

    if (record.auth.authHeaders.length > 0 && !record.auth.cookie && !hasAuthHeaders) {
      this.queue.update(job.id, {
        status: 'failed',
        errorKey: 'message.authReuseDisabled',
        errorDetail: record.auth.authHeaders.join(', ')
      });
      return;
    }

    // 中等置信度（URL 后缀推断）与需要鉴权的记录都先走离屏校验，前者失败可回退直连。
    if (hasAuthHeaders || needsMagicCheck) {
      await this.runOffscreenWithFallback(
        job,
        record,
        { headers: authHeaders, requirePdfMagic: needsMagicCheck },
        true
      );
      return;
    }

    if (record.auth.cookie) {
      await this.runOffscreenWithFallback(job, record, {}, true);
      return;
    }

    try {
      await runDirectDownload(this.transportCtx, job, record);
    } catch (error) {
      this.failJob(job, 'message.downloadFailed', error);
    }
  }

  private async runOffscreenWithFallback(
    job: DownloadJob,
    record: PdfRecord,
    options: OffscreenOptions,
    allowDirectFallback: boolean
  ): Promise<void> {
    try {
      await runOffscreenDownload(this.transportCtx, job, record, options);
      return;
    } catch (error) {
      if (this.queue.isCanceled(job.id)) return;

      if (!allowDirectFallback) {
        this.failJob(job, 'message.downloadFailed', error);
        return;
      }

      try {
        await runDirectDownload(this.transportCtx, job, record);
      } catch (fallbackError) {
        this.failJob(job, 'message.downloadFailed', fallbackError);
      }
    }
  }

  private failJob(job: DownloadJob, errorKey: string, error: unknown): void {
    if (this.queue.isCanceled(job.id)) return;
    this.queue.update(job.id, {
      status: 'failed',
      errorKey,
      errorDetail: error instanceof Error ? error.message : String(error)
    });
  }

  private releaseBlob(jobId: string): void {
    const job = this.queue.find(jobId);
    const blobUrl = job?.blobUrl;
    if (!job || !blobUrl) return;
    this.queue.update(jobId, { blobUrl: undefined });
    this.leases.release(blobUrl);
  }

  private readonly handleDownloadChanged = (delta: Browser.downloads.DownloadDelta): void => {
    const job = this.queue.list().find((item) => item.downloadId === delta.id);
    if (!job) return;

    const { patch, releaseLease, completed } = applyDownloadDelta(job, delta);
    if (releaseLease) this.releaseBlob(job.id);

    this.queue.update(job.id, patch);

    if (completed) {
      void this.deps.onDownloadCompleted?.(job);
    }
    if (patch.status && isTerminalStatus(patch.status)) {
      this.queue.pump();
    }
  };

  /**
   * service worker 重启后的对账：
   * - 有 downloadId 的重新查询真实状态
   * - 无 downloadId 的先尝试认领可能已经创建的下载，避免重复下载
   */
  private async reconcileAfterRestart(): Promise<void> {
    for (const job of this.queue.list()) {
      if (!isActiveStatus(job.status)) continue;
      if (job.status === 'queued') continue;

      if (job.downloadId === undefined) {
        const adopted = await this.adoptOrphanDownload(job);
        if (!adopted) this.queue.update(job.id, { status: 'queued' });
        continue;
      }

      try {
        const [item] = await browser.downloads.search({ id: job.downloadId });
        if (!item) {
          this.queue.update(job.id, {
            status: 'failed',
            errorKey: 'message.downloadInterrupted'
          });
          this.releaseBlob(job.id);
          continue;
        }
        if (item.state === 'complete') {
          this.queue.update(job.id, {
            status: 'done',
            receivedBytes: item.fileSize,
            totalBytes: item.totalBytes || item.fileSize
          });
          this.releaseBlob(job.id);
        } else if (item.state === 'interrupted') {
          this.queue.update(job.id, {
            status: 'failed',
            errorKey: 'message.downloadInterrupted'
          });
          this.releaseBlob(job.id);
        } else {
          this.queue.update(job.id, {
            status: 'downloading',
            receivedBytes: item.bytesReceived,
            totalBytes: item.totalBytes
          });
        }
      } catch {
        this.queue.update(job.id, { status: 'failed', errorKey: 'message.downloadInterrupted' });
        this.releaseBlob(job.id);
      }
    }
  }

  /**
   * 重启时正在创建下载（无 downloadId）的任务：按文件名与时间窗在 downloads
   * 里认领已存在的条目；认领失败才回到队列。
   */
  private async adoptOrphanDownload(job: DownloadJob): Promise<boolean> {
    const staleBlobUrl = job.blobUrl;
    if (staleBlobUrl) {
      // 重启后离屏文档与其 blob URL 都已失效，直接丢弃租约
      this.queue.update(job.id, { blobUrl: undefined });
      this.leases.handleExpired(staleBlobUrl);
    }

    try {
      const [item] = await browser.downloads.search({
        filenameRegex: `${escapeRegExp(job.fileName)}$`,
        startedAfter: new Date(job.createdAt - 5000).toISOString(),
        limit: 1,
        orderBy: ['-startTime']
      });
      if (!item?.id) return false;

      if (item.state === 'complete') {
        this.queue.update(job.id, {
          status: 'done',
          downloadId: item.id,
          receivedBytes: item.fileSize,
          totalBytes: item.totalBytes || item.fileSize
        });
      } else if (item.state === 'interrupted') {
        this.queue.update(job.id, {
          status: 'failed',
          downloadId: item.id,
          errorKey: 'message.downloadInterrupted'
        });
      } else {
        this.queue.update(job.id, { status: 'downloading', downloadId: item.id });
      }
      return true;
    } catch {
      return false;
    }
  }
}
