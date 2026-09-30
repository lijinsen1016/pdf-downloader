import { isHttpUrl, normalizeUrl } from '../shared/url';
import type { PdfRecord, Settings } from '../shared/types';
import { clearAuthHeaders, deleteAuthHeaders } from '../storage/auth-header-repo';
import { clearPostBodies, deletePostBodies } from '../storage/post-body-repo';
import {
  clearRecords,
  loadRecords,
  saveRecords,
  splitRecordsByRetention
} from '../storage/records-repo';
import { clearTokens, deleteTokens } from '../storage/token-repo';
import { buildDomRecord } from './record-factory';

export interface RecordStoreDeps {
  getSettings: () => Settings;
  onChange: (records: PdfRecord[]) => void;
}

/**
 * 记录的唯一持有者：负责列表裁剪、去重与「记录消失时同步清理会话凭证」。
 * 所有会减少记录数量的路径都必须经过 trimToSettings/dropExtras，
 * 否则 storage.session 里的 Authorization / POST body 会成为孤儿数据。
 */
export class RecordStore {
  private records: PdfRecord[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RecordStoreDeps) {}

  async load(): Promise<void> {
    this.records = await loadRecords();
  }

  list(): PdfRecord[] {
    return this.records;
  }

  findByUrl(url: string): PdfRecord | undefined {
    const normalized = normalizeUrl(url);
    return this.records.find((record) => normalizeUrl(record.url) === normalized);
  }

  async addDomRecords(links: Array<{ url: string }>, tabId?: number): Promise<number> {
    const now = Date.now();
    let added = 0;

    for (const link of links) {
      if (!isHttpUrl(link.url)) continue;
      const normalized = normalizeUrl(link.url);
      const existingIndex = this.records.findIndex(
        (record) => normalizeUrl(record.url) === normalized
      );
      if (existingIndex >= 0) {
        const existing = this.records[existingIndex];
        if (existing?.source !== 'dom') continue;
        this.records.splice(existingIndex, 1);
      }

      this.records.unshift(buildDomRecord(link.url, tabId, now));
      added += 1;
    }

    if (added > 0) {
      await this.trimToSettings();
      await this.persist();
    }
    return added;
  }

  async upsert(record: PdfRecord): Promise<void> {
    const normalized = normalizeUrl(record.url);
    const existingIndex = this.records.findIndex(
      (item) => normalizeUrl(item.url) === normalized
    );
    if (existingIndex >= 0) {
      const displaced = this.records[existingIndex];
      this.records.splice(existingIndex, 1);
      await this.dropExtras(displaced ? [displaced] : []);
    }

    this.records.unshift(record);
    await this.trimToSettings();
    await this.persist();
  }

  async delete(id: string): Promise<PdfRecord[]> {
    const record = this.records.find((item) => item.id === id);
    this.records = this.records.filter((item) => item.id !== id);
    await this.dropExtras(record ? [record] : []);
    await this.persist();
    return this.records;
  }

  async clear(): Promise<PdfRecord[]> {
    this.records = [];
    await clearTokens();
    await clearAuthHeaders();
    await clearPostBodies();
    await clearRecords();
    this.deps.onChange([]);
    return [];
  }

  async applySettings(settings: Settings): Promise<void> {
    await this.trimToSettings(settings);
    await this.persist();
  }

  /** Range 响应补全已有记录的大小；返回是否发生了变更。 */
  async updateSize(url: string, totalBytes: number): Promise<boolean> {
    const existing = this.findByUrl(url);
    if (!existing || existing.size === totalBytes) return false;
    existing.size = totalBytes;
    existing.partial = true;
    await this.persist();
    return true;
  }

  persist(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await saveRecords(this.records);
        this.deps.onChange(this.records);
      });
    return this.writeChain;
  }

  private async trimToSettings(settings = this.deps.getSettings()): Promise<void> {
    const { kept, dropped } = splitRecordsByRetention(this.records, settings);
    this.records = kept;
    if (dropped.length) {
      await this.dropExtras(dropped);
    }
  }

  private async dropExtras(records: PdfRecord[]): Promise<void> {
    if (!records.length) return;
    const ids = records.map((record) => record.id);
    const tokenRefs = records
      .flatMap((record) => [record.auth.tokenRef, record.auth.bearerTokenRef])
      .filter((ref): ref is string => Boolean(ref));

    await deleteAuthHeaders(ids);
    await deleteTokens(tokenRefs);
    await deletePostBodies(ids);
  }
}
