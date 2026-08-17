import { browser } from 'wxt/browser';
import { safeParse, offscreenToDocumentSchema } from '@/modules/protocol/schemas';
import { looksLikePdfFileName } from '@/modules/shared/file-name';
import { parseContentDisposition } from '@/modules/shared/content-disposition';

const controllers = new Map<string, AbortController>();
const blobUrls = new Set<string>();

const isPdfContentType = (contentType: string) => {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'text/pdf';
};

async function fetchPdfBlob(message: {
  jobId: string;
  url: string;
  authorizationHeader?: string;
  leaseMs?: number;
}): Promise<{ blobUrl: string; contentType: string; size: number }> {
  const controller = new AbortController();
  controllers.set(message.jobId, controller);

  try {
    const headers = new Headers();
    if (message.authorizationHeader) {
      headers.set('Authorization', message.authorizationHeader);
    }

    const response = await fetch(message.url, {
      method: 'GET',
      headers,
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const disposition = response.headers.get('content-disposition') ?? undefined;
    const dispositionName = parseContentDisposition(disposition).filename;
    if (!isPdfContentType(contentType) && !looksLikePdfFileName(dispositionName)) {
      throw new Error('response is not a PDF');
    }

    const blob = await response.blob();
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
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  });
