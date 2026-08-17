import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPopup, startPdfServer, waitForState } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

test.describe('v2 features', () => {
  test('scans the current page for PDF links on demand', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/scan.html`);
      const popup = await openPopup(context, extensionId);
      await page.bringToFront();

      await popup.evaluate(async () => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<{ ok?: boolean; count?: number }> } };
        }).chrome;
        const response = await chromeRef.runtime.sendMessage({ type: 'page/scan' });
        if (!response.ok) throw new Error('scan failed');
      });

      const state = await waitForState(
        popup,
        (s) => s.records.some((record) => record.source === 'dom' && record.url.endsWith('/file.pdf'))
      );
      const scanned = state.records.filter((record) => record.source === 'dom');
      expect(scanned.length).toBeGreaterThanOrEqual(1);
      expect(scanned.some((record) => record.url.includes('/no-pdf'))).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test('records download history when enabled', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      const popup = await openPopup(context, extensionId);
      await popup.evaluate(async () => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<{ ok?: boolean }> } };
        }).chrome;
        const response = await chromeRef.runtime.sendMessage({
          type: 'settings/update',
          patch: { historyEnabled: true }
        });
        if (!response.ok) throw new Error('failed to enable history');
      });

      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/file.pdf');
      });
      await page.waitForTimeout(500);

      const before = await waitForState(popup, (s) => s.records.some((record) => record.url.endsWith('/file.pdf')));
      const record = before.records.find((item) => item.url.endsWith('/file.pdf'))!;

      await popup.evaluate(async (recordId) => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };
        }).chrome;
        await chromeRef.runtime.sendMessage({ type: 'download/start', ids: [recordId] });
      }, record.id);

      const after = await waitForState(
        popup,
        (s) =>
          s.jobs.some((job) => job.recordId === record.id && job.status === 'done') &&
          s.history.some((item) => item.url.endsWith('/file.pdf')),
        20_000
      );
      expect(after.history.some((item) => item.url.endsWith('/file.pdf'))).toBe(true);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test('opens a bearer-auth PDF using a temporary DNR authorization rule', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      const popup = await openPopup(context, extensionId);
      await popup.evaluate(async () => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<{ ok?: boolean }> } };
        }).chrome;
        const response = await chromeRef.runtime.sendMessage({
          type: 'settings/update',
          patch: { reuseAuthorization: true }
        });
        if (!response.ok) throw new Error('failed to update settings');
      });

      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/bearer.pdf', { headers: { Authorization: 'Bearer e2e-secret' } });
      });
      await page.waitForTimeout(500);

      const state = await waitForState(
        popup,
        (s) => s.records.some((record) => record.url.endsWith('/bearer.pdf') && Boolean(record.auth.tokenRef))
      );
      const record = state.records.find((item) => item.url.endsWith('/bearer.pdf'))!;

      await popup.evaluate(async (recordId) => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };
        }).chrome;
        await chromeRef.runtime.sendMessage({ type: 'records/open', id: recordId });
      }, record.id);

      await context.waitForEvent('page', { timeout: 15_000 });
      await expect
        .poll(async () => {
          const result = await page.evaluate(async () => {
            const response = await fetch('/last-auth');
            return (await response.json()) as { authorization: string };
          });
          return result.authorization;
        })
        .toBe('Bearer e2e-secret');
    } finally {
      await context.close();
      await server.close();
    }
  });
});

test.describe('side panel', () => {
  test('loads the side panel entrypoint', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    try {
      const sidepanel = await context.newPage();
      await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await sidepanel.waitForLoadState('domcontentloaded');
      await expect(sidepanel.locator('.brand-copy h1')).toContainText('PDF');
    } finally {
      await context.close();
      await server.close();
    }
  });
});
