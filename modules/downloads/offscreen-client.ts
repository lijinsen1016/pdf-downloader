import { browser } from 'wxt/browser';
import { offscreenBlobResponseSchema } from '@/modules/protocol/schemas';
import type { StoredPostBody } from '@/modules/storage/post-body-repo';

const OFFSCREEN_PATH = '/offscreen.html';

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    return await browser.offscreen.hasDocument();
  } catch {
    return false;
  }
}

async function waitForOffscreenReady(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await browser.runtime.sendMessage({ type: 'offscreen/ping' });
      if (response?.ok) return;
    } catch {
      // 页面脚本可能尚未加载完成，继续重试
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('offscreen document is not responding');
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await browser.offscreen.createDocument({
    url: (browser.runtime as unknown as { getURL: (path: string) => string }).getURL(OFFSCREEN_PATH),
    reasons: ['BLOBS'],
    justification: 'Fetch authenticated PDFs outside the page CORS context and expose them as blob URLs for chrome.downloads.'
  });
  await waitForOffscreenReady();
}

export async function fetchBlobInOffscreen(params: {
  jobId: string;
  url: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  postBody?: StoredPostBody;
  leaseMs?: number;
  requirePdfMagic?: boolean;
}): Promise<{ blobUrl: string; contentType: string; size: number }> {
  await ensureOffscreenDocument();
  let response: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await browser.runtime.sendMessage({
        type: 'offscreen/fetch-blob',
        ...params
      });
      break;
    } catch {
      if (attempt === 2) throw new Error('offscreen document is not responding');
      await new Promise((resolve) => setTimeout(resolve, 150));
      await ensureOffscreenDocument();
    }
  }
  const parsed = offscreenBlobResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error('invalid offscreen response');
  }
  if (!parsed.data.ok || !parsed.data.blobUrl) {
    throw new Error(parsed.data.error || 'offscreen fetch failed');
  }
  return {
    blobUrl: parsed.data.blobUrl,
    contentType: parsed.data.contentType ?? '',
    size: parsed.data.size ?? 0
  };
}

export async function revokeBlobInOffscreen(blobUrl: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'offscreen/revoke-blob', blobUrl });
  } catch {
    // 文档可能已经关闭，URL 也会随之失效
  }
}

export async function cancelFetchInOffscreen(jobId: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'offscreen/cancel-fetch', jobId });
  } catch {
    // ignore
  }
}

export async function closeOffscreenDocument(): Promise<void> {
  try {
    if (await hasOffscreenDocument()) {
      await browser.offscreen.closeDocument();
    }
  } catch {
    // ignore
  }
}
