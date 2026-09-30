import { browser, type Browser } from 'wxt/browser';
import { getHost, isHttpUrl } from '../shared/url';
import {
  PENDING_SWEEP_INTERVAL_MS,
  TRACKED_RESOURCE_TYPES,
  type Settings
} from '../shared/types';
import { PendingRequestStore, parseContentRangeTotal, type PendingRequest } from './pending-requests';
import {
  buildPostBody,
  collectAuthHeaders,
  isCaptureEnabledFor,
  isHostIgnored
} from './record-factory';

export interface RequestTrackerDeps {
  getSettings: () => Settings;
  onRequestCompleted: (pending: PendingRequest, details: Browser.webRequest.OnCompletedDetails) => void;
}

const REQUEST_FILTER = {
  urls: ['http://*/*', 'https://*/*'],
  types: TRACKED_RESOURCE_TYPES
};

/**
 * 只负责 webRequest 事件的收集与在途请求（PendingRequest）的生命周期。
 * 判定与落库交给 CaptureEngine。
 */
export class RequestTracker {
  private readonly pending = new PendingRequestStore();
  private lastSweep = 0;
  private observersAttached = false;
  private bodyListenerAttached = false;

  constructor(private readonly deps: RequestTrackerDeps) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  start(): void {
    if (this.observersAttached) return;
    this.observersAttached = true;

    browser.webRequest.onBeforeSendHeaders.addListener(this.handleBeforeSendHeaders, REQUEST_FILTER, [
      'requestHeaders',
      'extraHeaders'
    ]);
    browser.webRequest.onHeadersReceived.addListener(this.handleHeadersReceived, REQUEST_FILTER, [
      'responseHeaders',
      'extraHeaders'
    ]);
    browser.webRequest.onBeforeRedirect.addListener(this.handleBeforeRedirect, REQUEST_FILTER);
    browser.webRequest.onCompleted.addListener(this.handleCompleted, REQUEST_FILTER);
    browser.webRequest.onErrorOccurred.addListener(this.handleErrorOccurred, REQUEST_FILTER);

    this.syncBodyListener();
  }

  /**
   * 注册 requestBody 会让 Chrome 持续为扩展采集请求体，
   * 因此只在「捕获开关 + POST 捕获」同时开启时才挂载该监听器。
   */
  syncBodyListener(): void {
    const settings = this.deps.getSettings();
    const wanted = settings.captureEnabled && settings.capturePostPdf;
    if (wanted === this.bodyListenerAttached) return;

    if (wanted) {
      browser.webRequest.onBeforeRequest.addListener(this.handleBeforeRequest, REQUEST_FILTER, [
        'requestBody'
      ]);
    } else {
      this.detachBodyListener();
      return;
    }
    this.bodyListenerAttached = true;
  }

  private detachBodyListener(): void {
    if (!this.bodyListenerAttached) return;
    browser.webRequest.onBeforeRequest.removeListener(this.handleBeforeRequest);
    this.bodyListenerAttached = false;
  }

  private maybeSweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < PENDING_SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    this.pending.sweep(now);
  }

  /** 被跟踪的请求才值得建 pending；类型过滤已在注册时生效，这里再兜一次底。 */
  private isTrackable(details: { tabId: number; requestId: string; url: string; method: string }): boolean {
    if (details.tabId < 0 || !details.requestId || !isHttpUrl(details.url)) return false;
    const settings = this.deps.getSettings();
    if (!isCaptureEnabledFor(settings, details.method)) return false;
    return !isHostIgnored(getHost(details.url), settings.ignoredHosts);
  }

  private readonly handleBeforeRequest = (
    details: Browser.webRequest.OnBeforeRequestDetails
  ): undefined => {
    if (details.method !== 'POST') return undefined;
    if (!this.isTrackable(details)) return undefined;

    const postBody = buildPostBody(details.requestBody);
    if (!postBody) return undefined;

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
    return undefined;
  };

  private readonly handleBeforeSendHeaders = (
    details: Browser.webRequest.OnBeforeSendHeadersDetails
  ): undefined => {
    if (details.method !== 'GET' && details.method !== 'POST') return undefined;
    if (!this.isTrackable(details)) return undefined;
    this.maybeSweep();

    const headers = details.requestHeaders ?? [];
    const existing = this.pending.get(details.requestId);
    const hasCookie = headers.some((header) => header.name.toLowerCase() === 'cookie');
    const hasRange = headers.some((header) => header.name.toLowerCase() === 'range');
    const authHeaderValues = collectAuthHeaders(headers, this.deps.getSettings().reusableHeaders);

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
      return undefined;
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
    return undefined;
  };

  private readonly handleHeadersReceived = (
    details: Browser.webRequest.OnHeadersReceivedDetails
  ): undefined => {
    let pending = this.pending.get(details.requestId);

    if (!pending) {
      // service worker 可能在请求中途被回收：这里用响应信息自建 pending，
      // 保证 onCompleted 仍能把 PDF 落库，而不是整条请求丢失。
      if (!this.isTrackable(details)) return undefined;
      pending = {
        requestId: details.requestId,
        url: details.url,
        tabId: details.tabId,
        method: details.method,
        createdAt: Date.now(),
        hasCookie: false,
        hasRange: false,
        authHeaderValues: []
      };
      this.pending.set(pending);
    }

    if (details.statusCode >= 300 && details.statusCode < 400) {
      pending.finalUrl = details.url;
      return undefined;
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
    return undefined;
  };

  private readonly handleBeforeRedirect = (
    details: Browser.webRequest.OnBeforeRedirectDetails
  ): undefined => {
    const pending = this.pending.get(details.requestId);
    if (pending) pending.finalUrl = details.redirectUrl;
    return undefined;
  };

  private readonly handleCompleted = (details: Browser.webRequest.OnCompletedDetails): undefined => {
    const pending = this.pending.get(details.requestId);
    if (!pending) return undefined;
    this.pending.delete(details.requestId);

    if (!this.deps.getSettings().captureEnabled) return undefined;
    this.deps.onRequestCompleted(pending, details);
    return undefined;
  };

  private readonly handleErrorOccurred = (
    details: Browser.webRequest.OnErrorOccurredDetails
  ): undefined => {
    this.pending.delete(details.requestId);
    return undefined;
  };
}
