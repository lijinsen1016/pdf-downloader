import { browser, type Browser } from 'wxt/browser';
import { classifyPdf } from '../shared/classifier';
import { buildFileName } from '../shared/file-name';
import { getHost, isHttpUrl, normalizeUrl } from '../shared/url';
import {
  MAX_POST_BODY_BYTES,
  PENDING_TTL_MS,
  STORAGE_KEYS,
  type PdfRecord,
  type Settings
} from '../shared/types';
import {
  clearAuthHeaders,
  deleteAuthHeaders,
  saveAuthHeaders
} from '../storage/auth-header-repo';
import {
  clearPostBodies,
  deletePostBodies,
  savePostBody,
  type StoredPostBody
} from '../storage/post-body-repo';
import { clearRecords, loadRecords, saveRecords, trimRecords } from '../storage/records-repo';
import { clearTokens, deleteTokens } from '../storage/token-repo';
import {
  PendingRequestStore,
  parseContentRangeTotal,
  type CapturedAuthHeader,
  type PendingRequest
} from './pending-requests';

export interface CaptureEngineDeps {
  getSettings: () => Settings;
  onRecordsChanged: (records: PdfRecord[]) => void;
}

const FORBIDDEN_REUSABLE_HEADERS = new Set(['cookie', 'host', 'content-length', 'origin', 'referer']);

export class CaptureEngine {
  private records: PdfRecord[] = [];
  private readonly pending = new PendingRequestStore();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CaptureEngineDeps) {}

  async init(): Promise<void> {
    this.records = await loadRecords();
    this.registerListeners();
    this.schedulePendingSweep();
  }

  getRecords(): PdfRecord[] {
    return this.records;
  }

  async addDomRecords(links: Array<{ url: string }>, tabId?: number): Promise<number> {
    const now = Date.now();
    let added = 0;

    for (const link of links) {
      if (!isHttpUrl(link.url)) continue;
      const normalized = normalizeUrl(link.url);
      const existingIndex = this.records.findIndex((record) => normalizeUrl(record.url) === normalized);
      if (existingIndex >= 0) {
        const existing = this.records[existingIndex];
        if (existing?.source !== 'dom') continue;
        this.records.splice(existingIndex, 1);
      }

      this.records.unshift({
        id: crypto.randomUUID(),
        url: link.url,
        host: getHost(link.url),
        fileName: buildFileName(link.url),
        capturedAt: now,
        tabId,
        statusCode: 200,
        confidence: 'medium',
        auth: { cookie: false, authHeaders: [] },
        source: 'dom',
        method: 'GET'
      });
      added += 1;
    }

    if (added > 0) {
      this.records = trimRecords(this.records, this.deps.getSettings());
      await this.persist();
    }
    return added;
  }

  async deleteRecord(id: string): Promise<PdfRecord[]> {
    const record = this.records.find((item) => item.id === id);
    this.records = this.records.filter((item) => item.id !== id);
    await this.deleteRecordExtras(record);
    await this.persist();
    return this.records;
  }

  async clearAll(): Promise<PdfRecord[]> {
    this.records = [];
    await clearTokens();
    await clearAuthHeaders();
    await clearPostBodies();
    await clearRecords();
    this.deps.onRecordsChanged([]);
    return [];
  }

  async applySettings(settings: Settings): Promise<void> {
    const keptIds = new Set(trimRecords(this.records, settings).map((record) => record.id));
    const removed = this.records.filter((record) => !keptIds.has(record.id));
    this.records = trimRecords(this.records, settings);
    await this.deleteRecordExtras(removed);
    await this.persist();
  }

  private registerListeners(): void {
    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        this.handleBeforeRequest(details);
        return undefined;
      },
      { urls: ['http://*/*', 'https://*/*'] },
      ['requestBody']
    );

    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        this.handleBeforeSendHeaders(details);
        return undefined;
      },
      { urls: ['http://*/*', 'https://*/*'] },
      ['requestHeaders', 'extraHeaders']
    );

    browser.webRequest.onHeadersReceived.addListener(
      (details) => {
        this.handleHeadersReceived(details);
        return undefined;
      },
      { urls: ['http://*/*', 'https://*/*'] },
      ['responseHeaders', 'extraHeaders']
    );

    browser.webRequest.onBeforeRedirect.addListener(
      (details) => this.handleBeforeRedirect(details),
      { urls: ['http://*/*', 'https://*/*'] }
    );

    browser.webRequest.onCompleted.addListener(
      (details) => this.handleCompleted(details),
      { urls: ['http://*/*', 'https://*/*'] }
    );

    browser.webRequest.onErrorOccurred.addListener(
      (details) => this.pending.delete(details.requestId),
      { urls: ['http://*/*', 'https://*/*'] }
    );
  }

  private schedulePendingSweep(): void {
    setInterval(() => this.pending.sweep(), 60_000);
  }

  private handleBeforeRequest(details: Browser.webRequest.OnBeforeRequestDetails): void {
    const settings = this.deps.getSettings();
    if (!settings.captureEnabled || !settings.capturePostPdf) return;
    if (details.method !== 'POST') return;
    if (details.tabId < 0 || !details.requestId || !isHttpUrl(details.url)) return;
    if (this.isHostIgnored(getHost(details.url), settings.ignoredHosts)) return;

    const postBody = this.buildPostBody(details.requestBody);
    if (!postBody) return;

    this.pending.set({
      requestId: details.requestId,
      url: details.url,
      tabId: details.tabId,
      method: details.method,
      createdAt: Date.now(),
      hasCookie: false,
      hasRange: false,
      authHeaderValues: [],
      postBody
    });
  }

  private handleBeforeSendHeaders(details: Browser.webRequest.OnBeforeSendHeadersDetails): void {
    const settings = this.deps.getSettings();
    if (!settings.captureEnabled) return;
    const isGet = details.method === 'GET';
    const isPost = details.method === 'POST' && settings.capturePostPdf;
    if (!isGet && !isPost) return;
    if (details.tabId < 0 || !details.requestId || !isHttpUrl(details.url)) return;
    if (this.isHostIgnored(getHost(details.url), settings.ignoredHosts)) return;

    const headers = details.requestHeaders ?? [];
    const existing = this.pending.get(details.requestId);
    const hasCookie = headers.some((header) => header.name.toLowerCase() === 'cookie');
    const hasRange = headers.some((header) => header.name.toLowerCase() === 'range');
    const authHeaderValues = this.collectAuthHeaders(headers, settings.reusableHeaders);

    if (existing) {
      existing.method = details.method;
      existing.hasCookie = hasCookie;
      existing.hasRange = hasRange;
      existing.authHeaderValues = authHeaderValues;
      if (existing.postBody) {
        existing.postBody.contentType = headers.find(
          (header) => header.name.toLowerCase() === 'content-type'
        )?.value;
      }
      return;
    }

    this.pending.set({
      requestId: details.requestId,
      url: details.url,
      tabId: details.tabId,
      method: details.method,
      createdAt: Date.now(),
      hasCookie,
      hasRange,
      authHeaderValues
    });
  }

  private handleHeadersReceived(details: Browser.webRequest.OnHeadersReceivedDetails): void {
    const pending = this.pending.get(details.requestId);
    if (!pending) return;

    if (details.statusCode >= 300 && details.statusCode < 400) {
      pending.finalUrl = details.url;
      return;
    }

    const headers = details.responseHeaders ?? [];
    const findHeader = (name: string) =>
      headers.find((header) => header.name.toLowerCase() === name)?.value;

    const contentLengthRaw = findHeader('content-length');
    const contentLength = contentLengthRaw ? Number.parseInt(String(contentLengthRaw), 10) : undefined;

    pending.response = {
      statusCode: details.statusCode,
      contentType: findHeader('content-type'),
      contentDisposition: findHeader('content-disposition'),
      contentLength: contentLength && Number.isFinite(contentLength) ? contentLength : undefined,
      contentRangeTotal: parseContentRangeTotal(findHeader('content-range'))
    };
  }

  private handleBeforeRedirect(details: Browser.webRequest.OnBeforeRedirectDetails): void {
    const pending = this.pending.get(details.requestId);
    if (pending) pending.finalUrl = details.redirectUrl;
  }

  private handleCompleted(details: Browser.webRequest.OnCompletedDetails): void {
    const pending = this.pending.get(details.requestId);
    if (!pending) return;
    this.pending.delete(details.requestId);

    if (pending.hasRange) {
      this.updateRangeRecord(pending);
      return;
    }

    const statusCode = pending.response?.statusCode ?? details.statusCode;
    const verdict = classifyPdf({
      method: pending.method,
      statusCode,
      url: details.url,
      contentType: pending.response?.contentType,
      contentDisposition: pending.response?.contentDisposition
    });

    if (!verdict.isPdf) return;

    const auth = this.buildAuth(pending);
    const record: PdfRecord = {
      id: crypto.randomUUID(),
      url: details.url,
      finalUrl: pending.finalUrl,
      host: getHost(details.url),
      fileName: buildFileName(details.url, pending.response?.contentDisposition),
      mime: verdict.mime,
      size: pending.response?.contentLength,
      capturedAt: Date.now(),
      tabId: pending.tabId,
      statusCode,
      fromCache: pending.response?.fromCache,
      partial: statusCode === 206,
      confidence: verdict.confidence,
      auth,
      source: 'network',
      method: pending.method === 'POST' ? 'POST' : 'GET'
    };

    this.upsertRecord(record);
    void this.storeRecordExtras(record, pending).finally(() => this.persist());
  }

  private async storeRecordExtras(record: PdfRecord, pending: PendingRequest): Promise<void> {
    const settings = this.deps.getSettings();
    const reusableValues = Object.fromEntries(
      pending.authHeaderValues.map((header) => [header.name, header.value])
    );

    if (settings.reuseAuthorization && Object.keys(reusableValues).length > 0) {
      await saveAuthHeaders(record.id, reusableValues);
      record.auth.tokenRef = record.id;
    }

    if (record.method === 'POST' && pending.postBody) {
      await savePostBody(record.id, pending.postBody);
    }
  }

  private updateRangeRecord(pending: PendingRequest): void {
    const normalized = normalizeUrl(pending.url);
    const existing = this.records.find((record) => normalizeUrl(record.url) === normalized);
    if (!existing) return;
    const total = pending.response?.contentRangeTotal;
    if (total && existing.size !== total) {
      existing.size = total;
      existing.partial = true;
      void this.persist();
    }
  }

  private buildAuth(pending: PendingRequest): PdfRecord['auth'] {
    const auth: PdfRecord['auth'] = {
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

  private collectAuthHeaders(
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

  private buildPostBody(requestBody: Browser.webRequest.OnBeforeRequestDetails['requestBody']): StoredPostBody | undefined {
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

  private upsertRecord(record: PdfRecord): void {
    const normalized = normalizeUrl(record.url);
    const existingIndex = this.records.findIndex((item) => normalizeUrl(item.url) === normalized);
    if (existingIndex >= 0) {
      const removed = this.records[existingIndex];
      if (removed) void this.deleteRecordExtras(removed);
      this.records.splice(existingIndex, 1);
    }
    this.records.unshift(record);
    this.records = trimRecords(this.records, this.deps.getSettings());
  }

  private async deleteRecordExtras(recordOrRecords: PdfRecord | PdfRecord[] | undefined): Promise<void> {
    const records = Array.isArray(recordOrRecords)
      ? recordOrRecords
      : recordOrRecords
        ? [recordOrRecords]
        : [];
    if (!records.length) return;

    const ids = records.map((record) => record.id);
    const tokenRefs = records.flatMap((record) => [
      record.auth.tokenRef,
      record.auth.bearerTokenRef
    ]).filter((ref): ref is string => Boolean(ref));

    await deleteAuthHeaders(ids);
    await deleteTokens(tokenRefs);
    await deletePostBodies(ids);
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await saveRecords(this.records);
        this.deps.onRecordsChanged(this.records);
      });
    return this.writeChain;
  }

  private isHostIgnored(host: string, ignoredHosts: string[]): boolean {
    return ignoredHosts.some((pattern) => {
      const normalized = pattern.trim().toLowerCase();
      if (!normalized) return false;
      if (normalized.startsWith('*.')) {
        const suffix = normalized.slice(1);
        return host.toLowerCase().endsWith(suffix);
      }
      return host.toLowerCase() === normalized;
    });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export { PENDING_TTL_MS, STORAGE_KEYS };
