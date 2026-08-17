import { browser, type Browser } from 'wxt/browser';
import {
  MAX_CONCURRENT_DOWNLOADS,
  OFFSCREEN_BLOB_LEASE_MS,
  type DownloadJob,
  type PdfRecord,
  type Settings
} from '../shared/types';
import type { PortEvent } from '../protocol/schemas';
import { loadJobs, saveJobs } from '../storage/jobs-repo';
import {
  cancelFetchInOffscreen,
  closeOffscreenDocument,
  fetchBlobInOffscreen,
  revokeBlobInOffscreen
} from './offscreen-client';

export interface DownloadManagerDeps {
  getSettings: () => Settings;
  getRecords: () => PdfRecord[];
  getToken: (ref: string) => Promise<string | undefined>;
  broadcast: (event: PortEvent) => void;
}

const ACTIVE_STATUSES = new Set(['queued', 'fetching', 'starting', 'downloading']);

export class DownloadManager {
  private jobs: DownloadJob[] = [];
  private readonly leases = new Set<string>();
  private commitChain: Promise<void> = Promise.resolve();
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private initialized = false;

  constructor(private readonly deps: DownloadManagerDeps) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.jobs = await loadJobs();
    await this.reconcileAfterRestart();

    browser.downloads.onChanged.addListener((delta) => this.handleDownloadChanged(delta));
    this.commit();
    this.pump();
  }

  getJobs(): DownloadJob[] {
    return this.jobs;
  }

  async startDownloads(recordIds: string[]): Promise<DownloadJob[]> {
    const records = this.deps.getRecords();
    const now = Date.now();
    let added = 0;

    for (const recordId of recordIds) {
      const record = records.find((item) => item.id === recordId);
      if (!record) continue;
      if (this.jobs.some((job) => job.recordId === recordId && ACTIVE_STATUSES.has(job.status))) {
        continue;
      }

      this.jobs.push({
        id: crypto.randomUUID(),
        recordId,
        url: record.url,
        fileName: record.fileName,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      });
      added += 1;
    }

    if (added > 0) {
      this.commit();
      this.pump();
    }
    return this.jobs.filter((job) => recordIds.includes(job.recordId));
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) return;

    if (job.status === 'queued') {
      this.updateJob(jobId, { status: 'canceled' });
      return;
    }

    if (job.status === 'fetching') {
      await cancelFetchInOffscreen(jobId);
      this.updateJob(jobId, { status: 'canceled' });
      return;
    }

    if (job.status === 'starting') {
      // download() 调用尚未返回，标记取消；返回后由 startJob 负责清理
      this.updateJob(jobId, { status: 'canceled' });
      return;
    }

    if (job.status === 'downloading' && job.downloadId !== undefined) {
      await browser.downloads.cancel(job.downloadId);
      this.updateJob(jobId, { status: 'canceled' });
    }
  }

  async cancelAll(): Promise<void> {
    const cancelable = this.jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
    for (const job of cancelable) {
      await this.cancelJob(job.id);
    }
  }

  async openRecord(recordId: string): Promise<{ url: string; usedBlob: boolean }> {
    const record = this.deps.getRecords().find((item) => item.id === recordId);
    if (!record) {
      throw new Error('record not found');
    }

    if (record.auth.bearerScheme && record.auth.bearerTokenRef) {
      const token = await this.deps.getToken(record.auth.bearerTokenRef);
      if (token) {
        try {
          const blob = await fetchBlobInOffscreen({
            jobId: `open-${crypto.randomUUID()}`,
            url: record.url,
            authorizationHeader: token,
            leaseMs: OFFSCREEN_BLOB_LEASE_MS
          });
          this.leases.add(blob.blobUrl);
          await browser.tabs.create({ url: blob.blobUrl, active: true });
          return { url: blob.blobUrl, usedBlob: true };
        } catch {
          // 回退到原始 URL，让用户通过网页会话打开
        }
      }
    }

    await browser.tabs.create({ url: record.url, active: true });
    return { url: record.url, usedBlob: false };
  }

  handleBlobLeaseExpired(blobUrl: string): void {
    if (this.leases.delete(blobUrl)) {
      this.scheduleOffscreenClose();
    }
  }

  private async reconcileAfterRestart(): Promise<void> {
    for (const job of this.jobs) {
      if (!ACTIVE_STATUSES.has(job.status)) continue;
      if (job.status === 'queued') continue;

      if (job.downloadId === undefined) {
        // 后台重启时正在创建下载；回到队列重试
        job.status = 'queued';
        continue;
      }

      try {
        const [item] = await browser.downloads.search({ id: job.downloadId });
        if (!item) {
          job.status = 'failed';
          job.errorKey = 'message.downloadInterrupted';
          this.releaseBlob(job);
          continue;
        }
        if (item.state === 'complete') {
          job.status = 'done';
          job.receivedBytes = item.fileSize;
          job.totalBytes = item.totalBytes || item.fileSize;
          this.releaseBlob(job);
        } else if (item.state === 'interrupted') {
          job.status = 'failed';
          job.errorKey = 'message.downloadInterrupted';
          this.releaseBlob(job);
        } else {
          job.status = 'downloading';
          job.receivedBytes = item.bytesReceived;
          job.totalBytes = item.totalBytes;
        }
      } catch {
        job.status = 'failed';
        job.errorKey = 'message.downloadInterrupted';
        this.releaseBlob(job);
      }
    }
  }

  private pump(): void {
    const activeCount = () =>
      this.jobs.filter((job) => ['fetching', 'starting', 'downloading'].includes(job.status)).length;

    for (let i = 0; i < MAX_CONCURRENT_DOWNLOADS * 2; i += 1) {
      if (activeCount() >= MAX_CONCURRENT_DOWNLOADS) break;
      const job = this.jobs.find((item) => item.status === 'queued');
      if (!job) break;
      void this.startJob(job);
    }
  }

  private async startJob(job: DownloadJob): Promise<void> {
    const record = this.deps.getRecords().find((item) => item.id === job.recordId);
    if (!record) {
      this.updateJob(job.id, { status: 'failed', errorKey: 'message.recordNotFound' });
      return;
    }

    const tokenRef = record.auth.bearerTokenRef;
    const token = tokenRef ? await this.deps.getToken(tokenRef) : undefined;

    if (tokenRef && token) {
      try {
        await this.runOffscreenDownload(job, record, token);
      } catch (error) {
        this.failJob(job, 'message.downloadFailed', error);
      }
      return;
    }

    if (tokenRef && !token) {
      this.updateJob(job.id, { status: 'failed', errorKey: 'message.authTokenExpired' });
      return;
    }

    if (record.auth.cookie) {
      try {
        await this.runOffscreenDownload(job, record, undefined);
      } catch {
        if (job.status === 'canceled') return;
        try {
          await this.runDirectDownload(job, record);
        } catch (error) {
          this.failJob(job, 'message.downloadFailed', error);
        }
      }
      return;
    }

    try {
      await this.runDirectDownload(job, record);
    } catch (error) {
      this.failJob(job, 'message.downloadFailed', error);
    }
  }

  private async runDirectDownload(job: DownloadJob, record: PdfRecord): Promise<void> {
    this.updateJob(job.id, { status: 'starting', errorKey: undefined, errorDetail: undefined });
    const downloadId = await browser.downloads.download({
      url: record.url,
      filename: record.fileName,
      conflictAction: 'uniquify',
      saveAs: false
    });
    if (job.status === 'canceled') {
      await browser.downloads.cancel(downloadId);
      return;
    }
    this.updateJob(job.id, { status: 'downloading', downloadId });
  }

  private async runOffscreenDownload(
    job: DownloadJob,
    record: PdfRecord,
    authorizationHeader?: string
  ): Promise<void> {
    this.updateJob(job.id, { status: 'fetching', errorKey: undefined, errorDetail: undefined });
    const blob = await fetchBlobInOffscreen({
      jobId: job.id,
      url: record.url,
      authorizationHeader
    });

    if (job.status === 'canceled') {
      await revokeBlobInOffscreen(blob.blobUrl);
      return;
    }

    this.leases.add(blob.blobUrl);
    this.cancelOffscreenClose();

    try {
      this.updateJob(job.id, { status: 'starting', blobUrl: blob.blobUrl });
      const downloadId = await browser.downloads.download({
        url: blob.blobUrl,
        filename: record.fileName,
        conflictAction: 'uniquify',
        saveAs: false
      });

      const latest = this.jobs.find((item) => item.id === job.id);
      if (latest?.status === 'canceled') {
        this.releaseBlob(job);
        await browser.downloads.cancel(downloadId);
        return;
      }

      this.updateJob(job.id, { status: 'downloading', downloadId });
    } catch (error) {
      this.releaseBlob(job);
      throw error;
    }
  }

  private failJob(job: DownloadJob, errorKey: string, error: unknown): void {
    this.updateJob(job.id, {
      status: 'failed',
      errorKey,
      errorDetail: error instanceof Error ? error.message : String(error)
    });
  }

  private updateJob(jobId: string, patch: Partial<DownloadJob>): void {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
    this.commit();
  }

  private handleDownloadChanged(delta: Browser.downloads.DownloadDelta): void {
    const job = this.jobs.find((item) => item.downloadId === delta.id);
    if (!job) return;

    const patch: Partial<DownloadJob> = {};
    if (delta.totalBytes?.current !== undefined) patch.totalBytes = delta.totalBytes.current;
    if (delta.fileSize?.current !== undefined && job.status === 'done') {
      patch.totalBytes = delta.fileSize.current;
      patch.receivedBytes = delta.fileSize.current;
    }

    const state = delta.state?.current;
    if (state === 'complete') {
      patch.status = 'done';
      patch.errorKey = undefined;
      patch.errorDetail = undefined;
      if (patch.receivedBytes === undefined) patch.receivedBytes = patch.totalBytes;
      this.releaseBlob(job);
    } else if (state === 'interrupted') {
      patch.status = job.status === 'canceled' ? 'canceled' : 'failed';
      patch.errorKey = patch.status === 'failed' ? 'message.downloadInterrupted' : undefined;
      patch.errorDetail = undefined;
      this.releaseBlob(job);
    }

    this.updateJob(job.id, patch);
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
      this.pump();
    }
  }

  private releaseBlob(job: DownloadJob): void {
    if (!job.blobUrl) return;
    const blobUrl = job.blobUrl;
    job.blobUrl = undefined;
    if (this.leases.delete(blobUrl)) {
      void revokeBlobInOffscreen(blobUrl);
      this.scheduleOffscreenClose();
    }
  }

  private scheduleOffscreenClose(): void {
    if (this.leases.size > 0) return;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      void closeOffscreenDocument();
    }, 3000);
  }

  private cancelOffscreenClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
  }

  private commit(): void {
    this.commitChain = this.commitChain
      .catch(() => undefined)
      .then(async () => {
        const snapshot = this.jobs.map((job) => ({ ...job }));
        await saveJobs(snapshot);
        this.deps.broadcast({ type: 'jobs/changed', jobs: snapshot });
        this.updateBadge(snapshot);
      });
  }

  private updateBadge(snapshot: DownloadJob[]): void {
    const count = snapshot.filter((job) => ACTIVE_STATUSES.has(job.status)).length;
    void browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
    void browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  }
}
