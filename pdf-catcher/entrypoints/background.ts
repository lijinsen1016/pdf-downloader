import { defineBackground } from 'wxt/utils/define-background';
import { browser, type Browser } from 'wxt/browser';
import { CaptureEngine } from '@/modules/capture/capture-engine';
import { DownloadManager } from '@/modules/downloads/download-manager';
import { popupToBackgroundSchema, safeParse, type PortEvent } from '@/modules/protocol/schemas';
import { getSettings, saveSettings, subscribeSettings } from '@/modules/storage/settings-repo';
import { loadTokens } from '@/modules/storage/token-repo';
import { DEFAULT_SETTINGS, type Settings } from '@/modules/shared/types';

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

  const downloadManager = new DownloadManager({
    getSettings: () => settings,
    getRecords: () => engine.getRecords(),
    getToken: async (ref) => (await loadTokens())[ref],
    broadcast
  });

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
