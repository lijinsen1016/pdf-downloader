export type PdfConfidence = 'high' | 'medium';

export interface PdfRecordAuth {
  /** 请求时浏览器是否带有 Cookie */
  cookie: boolean;
  /** 已识别的鉴权/自定义头名称（小写），只保存名称 */
  authHeaders: string[];
  /** 例如 'Bearer'，不包含 token 值 */
  bearerScheme?: string;
  /** 仅当用户开启会话级复用且头值已保存时存在 */
  tokenRef?: string;
  /** @deprecated 兼容旧会话记录，新记录使用 tokenRef */
  bearerTokenRef?: string;
}

export interface PdfRecord {
  id: string;
  url: string;
  finalUrl?: string;
  host: string;
  fileName: string;
  mime?: string;
  size?: number;
  capturedAt: number;
  tabId?: number;
  statusCode: number;
  /** 仅通过 Range 请求观察到、尚未拿到完整响应体的记录 */
  partial?: boolean;
  confidence: PdfConfidence;
  auth: PdfRecordAuth;
  /** network: 来自 webRequest 捕获；dom: 来自页面链接扫描 */
  source?: 'network' | 'dom';
  /** 生成型 PDF 使用 POST 请求 */
  method?: 'GET' | 'POST';
}

export interface DownloadHistoryItem {
  id: string;
  fileName: string;
  url: string;
  host: string;
  size?: number;
  downloadedAt: number;
  jobId?: string;
  recordId?: string;
}

export type DownloadJobStatus =
  | 'queued'
  | 'fetching'
  | 'starting'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'canceled';

export interface DownloadJob {
  id: string;
  recordId: string;
  url: string;
  fileName: string;
  status: DownloadJobStatus;
  downloadId?: number;
  blobUrl?: string;
  errorKey?: string;
  errorDetail?: string;
  totalBytes?: number;
  receivedBytes?: number;
  createdAt: number;
  updatedAt: number;
}

export type Language = 'zh-CN' | 'en';

export interface Settings {
  captureEnabled: boolean;
  language: Language;
  retentionMinutes: number;
  maxRecords: number;
  reuseAuthorization: boolean;
  ignoredHosts: string[];
  /** 下载历史默认关闭，仅保存脱敏后的文件名/URL/时间 */
  historyEnabled: boolean;
  /** 是否捕获 POST 生成型 PDF，默认关闭 */
  capturePostPdf: boolean;
  /** 会话级复用白名单，例如 authorization / x-api-key / x-auth-token */
  reusableHeaders: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  captureEnabled: true,
  language: 'zh-CN',
  retentionMinutes: 30,
  maxRecords: 200,
  reuseAuthorization: false,
  ignoredHosts: [],
  historyEnabled: false,
  capturePostPdf: false,
  reusableHeaders: ['authorization']
};

export const STORAGE_KEYS = {
  records: 'records:v1',
  settings: 'settings:v1',
  jobs: 'downloadJobs:v1',
  bearerTokens: 'bearerTokens:v1',
  history: 'history:v1',
  authHeaders: 'authHeaders:v1',
  postBodies: 'postBodies:v1'
} as const;

export const MAX_HISTORY_ITEMS = 500;
export const MAX_POST_BODY_BYTES = 2 * 1024 * 1024;

export const MAX_PENDING_REQUESTS = 2000;
export const PENDING_TTL_MS = 2 * 60 * 1000;
export const PENDING_SWEEP_INTERVAL_MS = 60 * 1000;
export const MAX_CONCURRENT_DOWNLOADS = 3;
/** UI 上允许继续追加任务的阈值（队列自带并发限制，这里只做按钮节流）。 */
export const UI_MAX_ACTIVE_JOBS = MAX_CONCURRENT_DOWNLOADS * 2;
export const OFFSCREEN_BLOB_LEASE_MS = 10 * 60 * 1000;

/**
 * 会话存储（storage.session 默认 10MB）的软上限：
 * 超出后按插入顺序淘汰最旧的记录，避免配额打满导致写入静默失败。
 */
export const MAX_STORED_AUTH_HEADER_SETS = 300;
export const MAX_STORED_POST_BODIES = 20;
export const MAX_STORED_POST_BODY_BYTES = 6 * 1024 * 1024;

/** 只有这些资源类型可能承载 PDF，其余请求不进入捕获管线。 */
export type TrackedResourceType = 'main_frame' | 'sub_frame' | 'object' | 'xmlhttprequest' | 'other';

export const TRACKED_RESOURCE_TYPES: TrackedResourceType[] = [
  'main_frame',
  'sub_frame',
  'object',
  'xmlhttprequest',
  'other'
];
