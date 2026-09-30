import { defineBackground } from 'wxt/utils/define-background';
import { browser, type Browser } from 'wxt/browser';
import { CaptureEngine } from '@/modules/capture/capture-engine';
import { collectPdfLinks } from '@/modules/capture/page-scanner';
import { DownloadManager } from '@/modules/downloads/download-manager';
import { popupToBackgroundSchema, safeParse, type PortEvent } from '@/modules/protocol/schemas';
import { loadAuthHeaders } from '@/modules/storage/auth-header-repo';
import {
  addHistoryItem,
  clearHistory,
  deleteHistoryItem,
  loadHistory
} from '@/modules/storage/history-repo';
import { getSettings, saveSettings, subscribeSettings } from '@/modules/storage/settings-repo';
import { loadTokens } from '@/modules/storage/token-repo';
import { DEFAULT_SETTINGS, type PdfRecord, type Settings } from '@/modules/shared/types';
import { getHost } from '@/modules/shared/url';

export default defineBackground(() => {
  const ports = new Set<Browser.runtime.Port>();
  let settings: Settings = { ...DEFAULT_SETTINGS };

  const broadcast = (event: PortEvent) => {
    for (const port of ports) {
      try {
        port.postMessage(event);
      } catch {
        ports.delete(port);
      }
    }
  };

  const engine = new CaptureEngine({
    getSettings: () => settings,
    onRecordsChanged: (records) => {
      broadcast({ type: 'records/changed', records: records.map((record) => ({ ...record })) });
    }
  });

  async function getAuthHeadersForRecord(record: PdfRecord): Promise<Record<string, string>> {
    const ref = record.auth.tokenRef ?? record.auth.bearerTokenRef;
    if (!ref) return {};
    const stored = await loadAuthHeaders();
    const values = stored[ref];
    if (values) return { ...values };
    const legacy = await loadTokens();
    if (legacy[ref]) return { Authorization: legacy[ref] };
    return {};
  }

  const downloadManager = new DownloadManager({
    getSettings: () => settings,
    getRecords: () => engine.getRecords(),
    getAuthHeaders: getAuthHeadersForRecord,
    broadcast,
    onDownloadCompleted: async (job) => {
      if (!settings.historyEnabled) return;
      const history = await addHistoryItem({
        id: crypto.randomUUID(),
        fileName: job.fileName,
        url: job.url,
        host: getHost(job.url),
        size: job.totalBytes,
        downloadedAt: Date.now(),
        jobId: job.id,
        recordId: job.recordId
      });
      broadcast({ type: 'history/changed', history });
    }
  });

  async function scanActiveTab(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('message.noActiveTab');
    }

    const injections = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPdfLinks
    });

    const links = injections.flatMap((injection) => injection.result ?? []);
    return engine.addDomRecords(links, tab.id);
  }

  async function applySettings(patch: Partial<Settings>): Promise<Settings> {
    const next = await saveSettings(patch);
    settings = next;
    await engine.applySettings(next);
    broadcast({ type: 'settings/changed', settings: next });
    return next;
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'popup') return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = safeParse(popupToBackgroundSchema, message);

    if (!request) {
      if ((message as { type?: string } | null)?.type === 'offscreen/blob-lease-expired') {
        downloadManager.handleBlobLeaseExpired((message as { blobUrl: string }).blobUrl);
        sendResponse({ ok: true });
        return false;
      }
      return false;
    }

    void (async () => {
      try {
        switch (request.type) {
          case 'state/get': {
            await backgroundReady;
            sendResponse({
              ok: true,
              records: engine.getRecords(),
              jobs: downloadManager.getJobs(),
              history: await loadHistory(),
              settings
            });
            return;
          }
          case 'records/delete': {
            const records = await engine.deleteRecord(request.id);
            sendResponse({ ok: true, records });
            return;
          }
          case 'records/clear': {
            const records = await engine.clearAll();
            sendResponse({ ok: true, records });
            return;
          }
          case 'records/open': {
            const result = await downloadManager.openRecord(request.id);
            sendResponse({ ok: true, ...result });
            return;
          }
          case 'download/start': {
            const jobs = await downloadManager.startDownloads(request.ids);
            sendResponse({ ok: true, jobs });
            return;
          }
          case 'download/cancel': {
            await downloadManager.cancelJob(request.jobId);
            sendResponse({ ok: true });
            return;
          }
          case 'download/cancelAll': {
            await downloadManager.cancelAll();
            sendResponse({ ok: true });
            return;
          }
          case 'settings/get': {
            sendResponse({ ok: true, settings });
            return;
          }
          case 'settings/update': {
            const next = await applySettings(request.patch);
            sendResponse({ ok: true, settings: next });
            return;
          }
          case 'page/scan': {
            const count = await scanActiveTab();
            sendResponse({ ok: true, count });
            return;
          }
          case 'history/get': {
            sendResponse({ ok: true, history: await loadHistory() });
            return;
          }
          case 'history/delete': {
            const history = await deleteHistoryItem(request.id);
            broadcast({ type: 'history/changed', history });
            sendResponse({ ok: true, history });
            return;
          }
          case 'history/clear': {
            const history = await clearHistory();
            broadcast({ type: 'history/changed', history });
            sendResponse({ ok: true, history });
            return;
          }
        }
      } catch (error) {
        sendResponse({
          ok: false,
          errorKey: 'message.requestFailed',
          errorDetail: error instanceof Error ? error.message : String(error)
        });
      }
    })();

    return true;
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== 'scan-page') return;
    void scanActiveTab().catch(() => undefined);
  });

  const backgroundReady = (async () => {
    settings = await getSettings();
    await engine.init();
    await downloadManager.init();
    subscribeSettings(async (next) => {
      if (next === settings) return;
      settings = next;
      await engine.applySettings(next);
      broadcast({ type: 'settings/changed', settings: next });
    });
  })();

  void backgroundReady;
});
