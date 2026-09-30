import { describe, expect, it } from 'vitest';
import {
  inFlightCount,
  isActiveStatus,
  isInFlightStatus,
  isTerminalStatus,
  selectJobsToStart
} from '@/modules/downloads/job-status';
import { MAX_CONCURRENT_DOWNLOADS, type DownloadJob, type DownloadJobStatus } from '@/modules/shared/types';

function job(id: string, status: DownloadJobStatus): DownloadJob {
  return {
    id,
    recordId: `record-${id}`,
    url: `https://example.com/${id}.pdf`,
    fileName: `${id}.pdf`,
    status,
    createdAt: 0,
    updatedAt: 0
  };
}

describe('status helpers', () => {
  it('treats queued as active but not in flight', () => {
    expect(isActiveStatus('queued')).toBe(true);
    expect(isInFlightStatus('queued')).toBe(false);
    expect(isInFlightStatus('downloading')).toBe(true);
    expect(isTerminalStatus('done')).toBe(true);
    expect(isActiveStatus('done')).toBe(false);
  });

  it('counts only in-flight jobs', () => {
    const jobs = [job('a', 'downloading'), job('b', 'queued'), job('c', 'done')];
    expect(inFlightCount(jobs)).toBe(1);
  });
});

describe('selectJobsToStart', () => {
  it('starts a full batch while every job is still queued', () => {
    // 回归：早期实现把 queued 计入并发，排队 >= 3 时 pump() 会直接放弃，一个都启动不了
    const jobs = ['a', 'b', 'c', 'd'].map((id) => job(id, 'queued'));
    expect(selectJobsToStart(jobs).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(inFlightCount(jobs)).toBe(0);
  });

  it('respects the limit against jobs already in flight', () => {
    const jobs = [
      job('run1', 'downloading'),
      job('run2', 'fetching'),
      job('q1', 'queued'),
      job('q2', 'queued')
    ];
    expect(selectJobsToStart(jobs).map((item) => item.id)).toEqual(['q1']);
  });

  it('starts nothing when the limit is reached', () => {
    const jobs = [
      job('run1', 'downloading'),
      job('run2', 'starting'),
      job('run3', 'fetching'),
      job('q1', 'queued')
    ];
    expect(selectJobsToStart(jobs)).toEqual([]);
  });

  it('skips terminal and canceled jobs', () => {
    const jobs = [job('done', 'done'), job('bad', 'failed'), job('q1', 'queued')];
    expect(selectJobsToStart(jobs).map((item) => item.id)).toEqual(['q1']);
  });

  it('defaults the limit to MAX_CONCURRENT_DOWNLOADS', () => {
    const jobs = Array.from({ length: 10 }, (_, index) => job(`q${index}`, 'queued'));
    expect(selectJobsToStart(jobs)).toHaveLength(MAX_CONCURRENT_DOWNLOADS);
  });
});
