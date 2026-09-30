import { browser } from 'wxt/browser';
import { safeParse, offscreenToDocumentSchema } from '@/modules/protocol/schemas';
import { looksLikePdfFileName } from '@/modules/shared/file-name';
import { hasPdfMagic, isPdfContentType } from '@/modules/shared/pdf-signature';
import { parseContentDisposition } from '@/modules/shared/content-disposition';
import type { OffscreenErrorCode } from '@/modules/downloads/offscreen-errors';
import type { StoredPostBody } from '@/modules/storage/post-body-repo';

/** 带错误类别的响应失败，供 background 区分「不是 PDF」与「传输失败」。 */
class OffscreenResponseError extends Error {
  constructor(
    message: string,
    public readonly errorCode: OffscreenErrorCode
  ) {
    super(message);
    this.name = 'OffscreenResponseError';
  }
}

const controllers = new Map<string, AbortController>();
const blobUrls = new Set<string>();

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildPostRequest(body: StoredPostBody): { body?: BodyInit; contentType?: string } {
  if (body.kind === 'form') {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(body.formData ?? {})) {
      for (const value of values) params.append(key, value);
    }
    return {
      body: params.toString(),
      contentType: body.contentType || 'application/x-www-form-urlencoded'
    };
  }

  if (body.base64) {
    return { body: new Blob([base64ToBytes(body.base64)]), contentType: body.contentType };
  }
  return {};
}

async function fetchPdfBlob(message: {
  jobId: string;
  url: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  postBody?: StoredPostBody;
  leaseMs?: number;
  requirePdfMagic?: boolean;
}): Promise<{ blobUrl: string; contentType: string; size: number }> {
  const controller = new AbortController();
  controllers.set(message.jobId, controller);

  try {
    const headers = new Headers(message.headers ?? {});
    const method = message.method ?? 'GET';
    let body: BodyInit | undefined;
    let postContentType: string | undefined;

    if (method === 'POST' && message.postBody) {
      const built = buildPostRequest(message.postBody);
      body = built.body;
      postContentType = built.contentType;
    }

    if (postContentType && !headers.has('content-type')) {
      headers.set('content-type', postContentType);
    }

    const response = await fetch(message.url, {
      method,
      headers,
      body,
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new OffscreenResponseError(`HTTP ${response.status}`, 'http');
    }

    const contentType = response.headers.get('content-type') ?? '';
    const disposition = response.headers.get('content-disposition') ?? undefined;
    const dispositionName = parseContentDisposition(disposition).filename;

    const blob = await response.blob();
    const head = new Uint8Array(await blob.slice(0, 1100).arrayBuffer());
    const magicOk = hasPdfMagic(head);

    if (!magicOk && !isPdfContentType(contentType) && !looksLikePdfFileName(dispositionName)) {
      throw new OffscreenResponseError('response is not a PDF', 'not-pdf');
    }
    // 仅凭 URL 后缀推断出来的记录（requirePdfMagic）必须靠魔数确认，
    // 否则会把返回 HTML 的 *.pdf 当成 PDF 下载下来。
    if (!magicOk && message.requirePdfMagic) {
      throw new OffscreenResponseError('response is not a PDF', 'not-pdf');
    }

    const blobUrl = URL.createObjectURL(blob);
    blobUrls.add(blobUrl);

    if (message.leaseMs) {
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        blobUrls.delete(blobUrl);
        void browser.runtime.sendMessage({ type: 'offscreen/blob-lease-expired', blobUrl });
      }, message.leaseMs);
    }

    return { blobUrl, contentType, size: blob.size };
  } finally {
    controllers.delete(message.jobId);
  }
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = safeParse(offscreenToDocumentSchema, message);
  if (!request) return false;

  if (request.type === 'offscreen/ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === 'offscreen/revoke-blob') {
    URL.revokeObjectURL(request.blobUrl);
    blobUrls.delete(request.blobUrl);
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === 'offscreen/cancel-fetch') {
    controllers.get(request.jobId)?.abort();
    sendResponse({ ok: true });
    return false;
  }

  void fetchPdfBlob(request)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof OffscreenResponseError ? error.errorCode : 'network'
      });
    });
  return true;
});
