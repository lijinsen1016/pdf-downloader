import type { Browser } from 'wxt/browser';
import type { DownloadJob } from '../shared/types';

export interface DownloadDeltaResult {
  patch: Partial<DownloadJob>;
  /** 需要吊销该任务持有的 blob 租约 */
  releaseLease: boolean;
  /** 本次 delta 让任务进入完成态，需要写入下载历史 */
  completed: boolean;
}

/** Chrome 在大小未知时上报 -1，这类值不能进入任务字段（会破坏响应 schema 校验）。 */
export function normalizeByteCount(value: number | undefined): number | undefined {
  return value !== undefined && value >= 0 ? value : undefined;
}

/** 把已持久化任务里的 -1 归一化为 undefined。 */
export function normalizeJobSize(job: DownloadJob): DownloadJob {
  return {
    ...job,
    totalBytes: normalizeByteCount(job.totalBytes),
    receivedBytes: normalizeByteCount(job.receivedBytes)
  };
}

/**
 * 把 chrome.downloads 的 delta 转换成任务补丁（纯函数，便于单测）。
 *
 * 注意：完成事件通常与 fileSize 出现在同一条 delta 中，因此这里不能再用
 * `job.status === 'done'` 作为采纳 fileSize 的前提，否则 blob 下载会丢失大小。
 */
export function applyDownloadDelta(
  job: DownloadJob,
  delta: Browser.downloads.DownloadDelta
): DownloadDeltaResult {
  const patch: Partial<DownloadJob> = {};

  const received = normalizeByteCount(delta.totalBytes?.current);
  if (received !== undefined) {
    patch.totalBytes = received;
  }
  // fileSize 是已知的最终文件大小（chunked 响应未结束时 Chrome 会上报 -1）。
  const fileSize = normalizeByteCount(delta.fileSize?.current);
  if (fileSize !== undefined && fileSize > 0) {
    patch.totalBytes = fileSize;
    patch.receivedBytes = fileSize;
  }

  const state = delta.state?.current;
  let releaseLease = false;
  let completed = false;

  if (state === 'complete') {
    patch.status = 'done';
    patch.errorKey = undefined;
    patch.errorDetail = undefined;
    if (patch.receivedBytes === undefined) {
      patch.receivedBytes = patch.totalBytes;
    }
    releaseLease = true;
    completed = true;
  } else if (state === 'interrupted') {
    const canceled = job.status === 'canceled';
    patch.status = canceled ? 'canceled' : 'failed';
    patch.errorKey = canceled ? undefined : 'message.downloadInterrupted';
    patch.errorDetail = undefined;
    releaseLease = true;
  }

  return { patch, releaseLease, completed };
}
