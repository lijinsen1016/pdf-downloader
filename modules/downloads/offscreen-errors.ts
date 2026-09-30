export type OffscreenErrorCode = 'not-pdf' | 'http' | 'network';

/** 离屏取回失败，并区分「传输失败」与「内容不是 PDF」。 */
export class OffscreenFetchError extends Error {
  constructor(
    message: string,
    public readonly code: OffscreenErrorCode
  ) {
    super(message);
    this.name = 'OffscreenFetchError';
  }
}

/** 内容校验失败：调用方不应退回直连下载，否则会把 HTML 当成 PDF 存下来。 */
export function isPdfVerificationError(error: unknown): boolean {
  return error instanceof OffscreenFetchError && error.code === 'not-pdf';
}

export function toOffscreenErrorCode(value: unknown): OffscreenErrorCode {
  return value === 'not-pdf' || value === 'http' || value === 'network' ? value : 'network';
}

/** 把离屏响应转换成错误对象。 */
export function toOffscreenError(response: {
  error?: string;
  errorCode?: unknown;
}): OffscreenFetchError {
  return new OffscreenFetchError(
    response.error ?? 'offscreen fetch failed',
    toOffscreenErrorCode(response.errorCode)
  );
}
