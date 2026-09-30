import { MAX_CONCURRENT_DOWNLOADS, type DownloadJob, type DownloadJobStatus } from '../shared/types';

/** 仍在队列或执行中的状态（用于徽标、UI 计数）。 */
export const ACTIVE_STATUSES: readonly DownloadJobStatus[] = [
  'queued',
  'fetching',
  'starting',
  'downloading'
];

/** 真正占用并发额度的状态：queued 不算，否则队列一长就会饿死自己。 */
export const IN_FLIGHT_STATUSES: readonly DownloadJobStatus[] = [
  'fetching',
  'starting',
  'downloading'
];

export const TERMINAL_STATUSES: readonly DownloadJobStatus[] = ['done', 'failed', 'canceled'];

export function isActiveStatus(status: DownloadJobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isInFlightStatus(status: DownloadJobStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status);
}

export function isTerminalStatus(status: DownloadJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function inFlightCount(jobs: DownloadJob[]): number {
  return jobs.filter((job) => isInFlightStatus(job.status)).length;
}

/**
 * 选出本轮可以启动的任务：只使用「执行中」数量做并发判断。
 * 早期实现误把 queued 计入并发，导致排队 >= MAX_CONCURRENT_DOWNLOADS 时
 * 一个任务都启动不了（纯函数，单测覆盖该回归）。
 */
export function selectJobsToStart(
  jobs: DownloadJob[],
  max = MAX_CONCURRENT_DOWNLOADS
): DownloadJob[] {
  const selected: DownloadJob[] = [];
  let inFlight = inFlightCount(jobs);

  for (const job of jobs) {
    if (inFlight >= max) break;
    if (job.status !== 'queued') continue;
    selected.push(job);
    inFlight += 1;
  }

  return selected;
}
