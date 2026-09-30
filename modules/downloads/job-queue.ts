import { browser } from 'wxt/browser';
import { MAX_CONCURRENT_DOWNLOADS, type DownloadJob, type DownloadJobStatus, type PdfRecord } from '../shared/types';
import type { PortEvent } from '../protocol/schemas';
import { clearJobs, loadJobs, saveJobs } from '../storage/jobs-repo';

const ACTIVE_STATUSES = new Set<DownloadJobStatus>([
  'queued',
  'fetching',
  'starting',
  'downloading'
]);

const TERMINAL_STATUSES = new Set<DownloadJobStatus>(['done', 'failed', 'canceled']);

export function isActiveStatus(status: DownloadJobStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isTerminalStatus(status: DownloadJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface JobQueueDeps {
  /** 队列把任务交给执行器；执行器负责真正发起下载。 */
  onJobReady: (job: DownloadJob) => void;
  broadcast: (event: PortEvent) => void;
}

/**
 * 下载任务队列：任务增删改、并发调度与持久化都在这里，不接触 chrome.downloads。
 */
export class JobQueue {
  private jobs: DownloadJob[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: JobQueueDeps) {}

  async init(): Promise<void> {
    this.jobs = await loadJobs();
  }

  list(): DownloadJob[] {
    return this.jobs;
  }

  find(jobId: string): DownloadJob | undefined {
    return this.jobs.find((job) => job.id === jobId);
  }

  findActiveByRecord(recordId: string): DownloadJob | undefined {
    return this.jobs.find((job) => job.recordId === recordId && isActiveStatus(job.status));
  }

  activeCount(): number {
    return this.jobs.filter((job) => isActiveStatus(job.status)).length;
  }

  isCanceled(jobId: string): boolean {
    return this.find(jobId)?.status === 'canceled';
  }

  /** 为记录创建 queued 任务，已在队列中的记录会被跳过。 */
  enqueue(records: PdfRecord[], now = Date.now()): number {
    let added = 0;
    for (const record of records) {
      if (this.jobs.some((job) => job.recordId === record.id && isActiveStatus(job.status))) {
        continue;
      }
      this.jobs.push({
        id: crypto.randomUUID(),
        recordId: record.id,
        url: record.url,
        fileName: record.fileName,
        status: 'queued',
        createdAt: now,
        updatedAt: now
      });
      added += 1;
    }
    return added;
  }

  update(jobId: string, patch: Partial<DownloadJob>): void {
    const job = this.find(jobId);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
    this.commit();
  }

  removeJobsForRecord(recordId: string): void {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => job.recordId !== recordId);
    if (this.jobs.length !== before) this.commit();
  }

  async clear(): Promise<void> {
    this.jobs = [];
    await clearJobs();
    this.deps.broadcast({ type: 'jobs/changed', jobs: [] });
    this.updateBadge([]);
  }

  /**
   * 填满并发额度。任务在这里同步标记为 fetching 占位，
   * 否则同一批 queued 任务会被重复调度成多个下载。
   */
  pump(): void {
    for (let index = 0; index < MAX_CONCURRENT_DOWNLOADS * 2; index += 1) {
      if (this.activeCount() >= MAX_CONCURRENT_DOWNLOADS) break;
      const next = this.jobs.find((job) => job.status === 'queued');
      if (!next) break;

      next.status = 'fetching';
      next.updatedAt = Date.now();
      try {
        this.deps.onJobReady(next);
      } catch (error) {
        this.update(next.id, {
          status: 'failed',
          errorKey: 'message.downloadFailed',
          errorDetail: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  commit(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const snapshot = this.jobs.map((job) => ({ ...job }));
        await saveJobs(snapshot);
        this.deps.broadcast({ type: 'jobs/changed', jobs: snapshot });
        this.updateBadge(snapshot);
      });
    return this.writeChain;
  }

  private updateBadge(snapshot: DownloadJob[]): void {
    const count = snapshot.filter((job) => isActiveStatus(job.status)).length;
    void browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
    void browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  }
}
