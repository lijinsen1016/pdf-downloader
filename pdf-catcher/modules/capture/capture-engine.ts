import { browser, type Browser } from 'wxt/browser';
import { classifyPdf } from '../shared/classifier';
import { buildFileName } from '../shared/file-name';
import { getHost, isHttpUrl, normalizeUrl } from '../shared/url';
import {
  PENDING_TTL_MS,
  STORAGE_KEYS,
  type PdfRecord,
  type Settings
} from '../shared/types';
import { clearRecords, loadRecords, saveRecords, trimRecords } from '../storage/records-repo';
import { clearTokens, deleteTokens, saveToken } from '../storage/token-repo';
import { PendingRequestStore, parseContentRangeTotal } from './pending-requests';

export interface CaptureEngineDeps {
  getSettings: () => Settings;
  onRecordsChanged: (records: PdfRecord[]) => void;
}

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

  async deleteRecord(id: string): Promise<PdfRecord[]> {
    this.records = this.records.filter((record) => record.id !== id);
    await deleteTokens([id]);
    await this.persist();
    return this.records;
  }

  async clearAll(): Promise<PdfRecord[]> {
    this.records = [];
    await clearTokens();
    await clearRecords();
    this.deps.onRecordsChanged([]);
    return [];
  }

  async applySettings(settings: Settings): Promise<void> {
    const keptIds = new Set(trimRecords(this.records, settings).map((record) => record.id));
    const removedIds = this.records
      .filter((record) => !keptIds.has(record.id))
      .map((record) => record.id);
    this.records = trimRecords(this.records, settings);
    if (removedIds.length) await deleteTokens(removedIds);
    await this.persist();
  }

  private registerListeners(): void {
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

  private handleBeforeSendHeaders(details: Browser.webRequest.OnBeforeSendHeadersDetails): void {
    const settings = this.deps.getSettings();
    if (!settings.captureEnabled) return;
    if (details.method !== 'GET') return;
    if (details.tabId < 0) return;
    if (!details.requestId || !isHttpUrl(details.url)) return;

    const host = getHost(details.url);
    if (this.isHostIgnored(host, settings.ignoredHosts)) return;

    const headers = details.requestHeaders ?? [];
    const hasCookie = headers.some((header) => header.name.toLowerCase() === 'cookie');
    const hasRange = headers.some((header) => header.name.toLowerCase() === 'range');
    const authorization = headers.find((header) => header.name.toLowerCase() === 'authorization');

    this.pending.set({
      requestId: details.requestId,
      url: details.url,
      tabId: details.tabId,
      method: details.method,
      createdAt: Date.now(),
      hasCookie,
      hasRange,
      authorizationValue: authorization?.value ? String(authorization.value) : undefined
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

    const settings = this.deps.getSettings();
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
      auth
    };

    this.upsertRecord(record);

    const authorization = pending.authorizationValue;
    if (settings.reuseAuthorization && authorization && record.auth.bearerScheme) {
      void saveToken(record.id, authorization);
      record.auth.bearerTokenRef = record.id;
    }

    void this.persist();
  }

  private updateRangeRecord(pending: NonNullable<ReturnType<PendingRequestStore['get']>>): void {
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

  private buildAuth(pending: NonNullable<ReturnType<PendingRequestStore['get']>>): PdfRecord['auth'] {
    const auth: PdfRecord['auth'] = { cookie: pending.hasCookie };
    const authorization = pending.authorizationValue;
    if (!authorization) return auth;

    const match = /^(\S+)\s+\S+$/.exec(authorization.trim());
    if (!match?.[1]) return auth;
    const scheme = match[1];
    if (/bearer|token|api-?key|apikey/i.test(scheme)) {
      auth.bearerScheme = scheme;
    }
    return auth;
  }

  private upsertRecord(record: PdfRecord): void {
    const normalized = normalizeUrl(record.url);
    const existingIndex = this.records.findIndex((item) => normalizeUrl(item.url) === normalized);
    if (existingIndex >= 0) {
      const removed = this.records[existingIndex];
      if (removed?.auth.bearerTokenRef) void deleteTokens([removed.auth.bearerTokenRef]);
      this.records.splice(existingIndex, 1);
    }
    this.records.unshift(record);
    const settings = this.deps.getSettings();
    this.records = trimRecords(this.records, settings);
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

export { PENDING_TTL_MS, STORAGE_KEYS };
