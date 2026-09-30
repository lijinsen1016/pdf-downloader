import { computed, ref } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';
import { request } from '@/modules/protocol/client';
import { isActiveStatus } from '@/modules/downloads/job-queue';
import { UI_MAX_ACTIVE_JOBS, type DownloadJob } from '@/modules/shared/types';
import { describeError } from '@/modules/protocol/errors';

export interface DownloadJobsDeps {
  t: ComposerTranslation;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

/** 下载任务视图状态：进度、状态文案、取消与重试。 */
export function useDownloadJobs({ t, showToast }: DownloadJobsDeps) {
  const jobs = ref<DownloadJob[]>([]);

  const activeJobCount = computed(
    () => jobs.value.filter((job) => isActiveStatus(job.status)).length
  );

  /** UI 只在队列已经堆积时才节流按钮；真正的并发由 JobQueue 控制。 */
  const canStartMoreJobs = computed(() => activeJobCount.value < UI_MAX_ACTIVE_JOBS);

  function setJobs(next: DownloadJob[]): void {
    jobs.value = next;
  }

  function activeJobForRecord(recordId: string): DownloadJob | undefined {
    return jobs.value.find((job) => job.recordId === recordId && isActiveStatus(job.status));
  }

  function jobForRecord(recordId: string): DownloadJob | undefined {
    const active = activeJobForRecord(recordId);
    if (active) return active;
    return jobs.value.find((job) => job.recordId === recordId && job.status !== 'done');
  }

  function statusForRecord(recordId: string): string {
    const job = jobForRecord(recordId);
    return job ? t(`status.${job.status}`) : '';
  }

  function jobProgress(job: DownloadJob): number {
    if (!job.totalBytes || !job.receivedBytes) return 0;
    return Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100));
  }

  function progressForRecord(recordId: string): number {
    const job = jobForRecord(recordId);
    return job ? jobProgress(job) : 0;
  }

  /** 原始错误细节，用于 title 提示。 */
  function errorForRecord(recordId: string): string {
    return jobForRecord(recordId)?.errorDetail ?? '';
  }

  /** 已本地化的错误文案，优先使用任务自带的 errorKey。 */
  function errorTextForRecord(recordId: string): string {
    const job = jobForRecord(recordId);
    if (!job) return '';
    if (job.errorKey) return t(job.errorKey);
    return job.errorDetail ?? '';
  }

  async function startDownloads(ids: string[]): Promise<void> {
    if (!ids.length) {
      showToast(t('message.noSelection'), 'error');
      return;
    }
    try {
      const response = await request({ type: 'download/start', ids });
      const created = response.jobs.filter((job) => isActiveStatus(job.status)).length;
      showToast(t(ids.length > 1 ? 'message.batchStarted' : 'message.downloadSuccess', { count: created }));
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  function downloadRecord(id: string): void {
    void startDownloads([id]);
  }

  async function cancelJob(jobId: string): Promise<void> {
    try {
      await request({ type: 'download/cancel', jobId });
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  function cancelForRecord(recordId: string): void {
    const job = activeJobForRecord(recordId);
    if (job) void cancelJob(job.id);
  }

  return {
    jobs,
    activeJobCount,
    canStartMoreJobs,
    setJobs,
    activeJobForRecord,
    jobForRecord,
    statusForRecord,
    jobProgress,
    progressForRecord,
    errorForRecord,
    errorTextForRecord,
    startDownloads,
    downloadRecord,
    cancelJob,
    cancelForRecord
  };
}
