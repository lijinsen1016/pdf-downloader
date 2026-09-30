import type { Browser } from 'wxt/browser';
import { classifyPdf } from '../shared/classifier';
import type { PdfRecord, Settings } from '../shared/types';
import { saveAuthHeaders } from '../storage/auth-header-repo';
import { savePostBody } from '../storage/post-body-repo';
import type { PendingRequest } from './pending-requests';
import { buildAuth, buildNetworkRecord, type PdfMatch } from './record-factory';
import { RecordStore } from './record-store';
import { RequestTracker } from './request-tracker';

export interface CaptureEngineDeps {
  getSettings: () => Settings;
  onRecordsChanged: (records: PdfRecord[]) => void;
}

/**
 * 组装层：把 RequestTracker 收集到的在途请求判定为 PDF 记录，并交给 RecordStore 落库。
 */
export class CaptureEngine {
  private readonly store: RecordStore;
  private readonly tracker: RequestTracker;

  constructor(private readonly deps: CaptureEngineDeps) {
    this.store = new RecordStore({
      getSettings: deps.getSettings,
      onChange: deps.onRecordsChanged
    });
    this.tracker = new RequestTracker({
      getSettings: deps.getSettings,
      onRequestCompleted: (pending, details) => this.handleCompleted(pending, details)
    });
  }

  async init(): Promise<void> {
    await this.store.load();
    this.tracker.start();
  }

  getRecords(): PdfRecord[] {
    return this.store.list();
  }

  addDomRecords(links: Array<{ url: string }>, tabId?: number): Promise<number> {
    return this.store.addDomRecords(links, tabId);
  }

  deleteRecord(id: string): Promise<PdfRecord[]> {
    return this.store.delete(id);
  }

  clearAll(): Promise<PdfRecord[]> {
    return this.store.clear();
  }

  async applySettings(settings: Settings): Promise<void> {
    this.tracker.syncBodyListener();
    await this.store.applySettings(settings);
  }

  private handleCompleted(
    pending: PendingRequest,
    details: Browser.webRequest.OnCompletedDetails
  ): void {
    const statusCode = pending.response?.statusCode ?? details.statusCode;

    if (pending.hasRange) {
      void this.handleRangeRequest(pending, details, statusCode);
      return;
    }

    const verdict = this.classify(details.url, statusCode, pending);
    if (!verdict) return;

    const record = buildNetworkRecord({
      url: details.url,
      finalUrl: pending.finalUrl,
      statusCode,
      method: pending.method,
      tabId: pending.tabId,
      response: pending.response,
      verdict,
      auth: buildAuth(pending)
    });
    void this.persistRecord(record, pending);
  }

  /**
   * Range 请求通常先于完整响应出现。已有记录时只补全总大小，
   * 否则在能判定为 PDF 的前提下直接落一条 partial 记录，避免内嵌阅读器场景漏捕获。
   */
  private async handleRangeRequest(
    pending: PendingRequest,
    details: Browser.webRequest.OnCompletedDetails,
    statusCode: number
  ): Promise<void> {
    const total = pending.response?.contentRangeTotal;
    const existing = this.store.findByUrl(details.url);

    if (existing) {
      if (total) await this.store.updateSize(details.url, total);
      return;
    }

    if (!total) return;

    const verdict = this.classify(details.url, statusCode, pending);
    if (!verdict) return;

    const record = buildNetworkRecord({
      url: details.url,
      finalUrl: pending.finalUrl,
      statusCode,
      method: pending.method,
      tabId: pending.tabId,
      response: pending.response,
      verdict,
      auth: buildAuth(pending),
      partial: true,
      size: total
    });
    void this.persistRecord(record, pending);
  }

  private classify(url: string, statusCode: number, pending: PendingRequest): PdfMatch | undefined {
    const verdict = classifyPdf({
      method: pending.method,
      statusCode,
      url,
      contentType: pending.response?.contentType,
      contentDisposition: pending.response?.contentDisposition
    });
    return verdict.isPdf ? verdict : undefined;
  }

  private async persistRecord(record: PdfRecord, pending: PendingRequest): Promise<void> {
    const settings = this.deps.getSettings();

    if (settings.reuseAuthorization) {
      const values = Object.fromEntries(
        pending.authHeaderValues.map((header) => [header.name, header.value])
      );
      if (Object.keys(values).length > 0) {
        await saveAuthHeaders(record.id, values);
        record.auth.tokenRef = record.id;
      }
    }

    if (record.method === 'POST' && pending.postBody) {
      await savePostBody(record.id, pending.postBody);
    }

    await this.store.upsert(record);
  }
}
