import { browser } from 'wxt/browser';
import { STORAGE_KEYS, type DownloadJob } from '../shared/types';
import { downloadJobSchema } from '../protocol/schemas';
import { normalizeJobSize } from '../downloads/download-delta';

const JOB_KEEP_MS = 60 * 60 * 1000;

export async function loadJobs(): Promise<DownloadJob[]> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.jobs);
  const value = raw[STORAGE_KEYS.jobs];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => downloadJobSchema.safeParse(item))
    .filter((parsed) => parsed.success)
    .map((parsed) => normalizeJobSize(parsed.data as DownloadJob));
}

export function pruneJobs(jobs: DownloadJob[]): DownloadJob[] {
  const cutoff = Date.now() - JOB_KEEP_MS;
  const terminal = new Set(['done', 'failed', 'canceled']);
  return jobs.filter((job) => !(terminal.has(job.status) && job.updatedAt < cutoff)).slice(-100);
}

export async function saveJobs(jobs: DownloadJob[]): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEYS.jobs]: pruneJobs(jobs) });
}

export async function clearJobs(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.jobs);
}
