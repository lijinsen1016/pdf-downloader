import type { Browser } from 'wxt/browser';
import type { DownloadJob } from '../shared/types';

export interface DownloadDeltaResult {
  patch: Partial<DownloadJob>;
  /** 需要吊销该任务持有的 blob 租约 */
  releaseLease: boolean;
  /** 本次 delta 让任务进入完成态，需要写入下载历史 */
  completed: boolean;
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

  if (delta.totalBytes?.current !== undefined) {
    patch.totalBytes = delta.totalBytes.current;
  }
  // fileSize 是已知的最终文件大小（chunked 响应未结束时 Chrome 会上报 -1）。
  // 完成事件通常与它同一条 delta 到达，因此不能再用 job.status === 'done' 作前提。
  if (delta.fileSize?.current !== undefined && delta.fileSize.current > 0) {
    patch.totalBytes = delta.fileSize.current;
    patch.receivedBytes = delta.fileSize.current;
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
