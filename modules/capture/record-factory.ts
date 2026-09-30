import type { Browser } from 'wxt/browser';
import { buildFileName } from '../shared/file-name';
import { getHost } from '../shared/url';
import {
  MAX_POST_BODY_BYTES,
  type PdfConfidence,
  type PdfRecord,
  type PdfRecordAuth,
  type Settings
} from '../shared/types';
import type { StoredPostBody } from '../storage/post-body-repo';
import type { CapturedAuthHeader, PendingRequest, PendingResponse } from './pending-requests';

/** 这些头由浏览器管理或涉及隐私，永不进入可复用白名单。 */
const FORBIDDEN_REUSABLE_HEADERS = new Set([
  'cookie',
  'host',
  'content-length',
  'origin',
  'referer'
]);

export interface PdfMatch {
  isPdf: true;
  confidence: PdfConfidence;
  mime?: string;
  fileName?: string;
  source?: string;
}

export interface NetworkRecordInput {
  url: string;
  finalUrl?: string;
  statusCode: number;
  method: string;
  tabId?: number;
  response?: PendingResponse;
  verdict: PdfMatch;
  auth: PdfRecordAuth;
  partial?: boolean;
  size?: number;
}

export function isHostIgnored(host: string, ignoredHosts: string[]): boolean {
  return ignoredHosts.some((pattern) => {
    const normalized = pattern.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith('*.')) {
      return host.toLowerCase().endsWith(normalized.slice(1));
    }
    return host.toLowerCase() === normalized;
  });
}

export function collectAuthHeaders(
  headers: Array<{ name: string; value?: string }>,
  reusableHeaders: string[]
): CapturedAuthHeader[] {
  const allowed = new Set(
    ['authorization', ...reusableHeaders].map((name) => name.trim().toLowerCase())
  );
  const result: CapturedAuthHeader[] = [];

  for (const header of headers) {
    const name = header.name.trim().toLowerCase();
    if (!name || FORBIDDEN_REUSABLE_HEADERS.has(name)) continue;
    if (!allowed.has(name) || typeof header.value !== 'string') continue;
    result.push({ name, value: header.value });
  }
  return result;
}

export function buildAuth(pending: PendingRequest): PdfRecordAuth {
  const auth: PdfRecordAuth = {
    cookie: pending.hasCookie,
    authHeaders: pending.authHeaderValues.map((header) => header.name.toLowerCase())
  };

  const authorization = pending.authHeaderValues.find(
    (header) => header.name.toLowerCase() === 'authorization'
  );
  if (!authorization) return auth;

  const match = /^(\S+)\s+\S+$/.exec(authorization.value.trim());
  if (match?.[1] && /bearer|token|api-?key|apikey/i.test(match[1])) {
    auth.bearerScheme = match[1];
  }
  return auth;
}

export function buildNetworkRecord(input: NetworkRecordInput): PdfRecord {
  return {
    id: crypto.randomUUID(),
    url: input.url,
    finalUrl: input.finalUrl,
    host: getHost(input.url),
    fileName: buildFileName(input.url, input.response?.contentDisposition),
    mime: input.verdict.mime,
    size: input.size ?? input.response?.contentLength,
    capturedAt: Date.now(),
    tabId: input.tabId,
    statusCode: input.statusCode,
    partial: input.partial,
    confidence: input.verdict.confidence,
    auth: input.auth,
    source: 'network',
    method: input.method === 'POST' ? 'POST' : 'GET'
  };
}

export function buildDomRecord(url: string, tabId: number | undefined, now: number): PdfRecord {
  return {
    id: crypto.randomUUID(),
    url,
    host: getHost(url),
    fileName: buildFileName(url),
    capturedAt: now,
    tabId,
    statusCode: 200,
    confidence: 'medium',
    auth: { cookie: false, authHeaders: [] },
    source: 'dom',
    method: 'GET'
  };
}

export function buildPostBody(
  requestBody: Browser.webRequest.OnBeforeRequestDetails['requestBody']
): StoredPostBody | undefined {
  if (!requestBody) return undefined;

  if (requestBody.formData) {
    let size = 0;
    const formData: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(requestBody.formData)) {
      const stringValues = (values ?? []).filter(
        (value): value is string => typeof value === 'string'
      );
      if (!stringValues.length) continue;
      for (const value of stringValues) size += value.length;
      if (size > MAX_POST_BODY_BYTES) return undefined;
      formData[key] = stringValues;
    }
    if (!Object.keys(formData).length) return undefined;
    return { kind: 'form', formData };
  }

  if (requestBody.raw?.length) {
    let total = 0;
    for (const entry of requestBody.raw) {
      if (entry.bytes) total += entry.bytes.byteLength;
    }
    if (total > MAX_POST_BODY_BYTES) return undefined;

    const chunks: Uint8Array[] = [];
    for (const entry of requestBody.raw) {
      if (entry.bytes) chunks.push(new Uint8Array(entry.bytes));
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { kind: 'raw', base64: bytesToBase64(bytes) };
  }

  return undefined;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function isCaptureEnabledFor(settings: Settings, method: string): boolean {
  if (!settings.captureEnabled) return false;
  if (method === 'GET') return true;
  return method === 'POST' && settings.capturePostPdf;
}
