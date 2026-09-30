import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getState, launchExtension, openPopup, startPdfServer, waitForState } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

test.describe('download engine', () => {
  test('downloads a public PDF through chrome.downloads', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/file.pdf');
      });
      await page.waitForTimeout(800);

      const popup = await openPopup(context, extensionId);
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
        (s) => s.jobs.some((job) => job.recordId === record.id && job.status === 'done'),
        20_000
      );

      const job = after.jobs.find((item) => item.recordId === record.id);
      expect(job?.status).toBe('done');
      expect(job?.errorDetail).toBeUndefined();
    } finally {
      await context.close();
      await server.close();
    }
  });

  test('downloads a cookie-authenticated PDF through the offscreen fallback', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/set-cookie`);
      await page.evaluate(async () => {
        await fetch('/cookie.pdf');
      });
      await page.waitForTimeout(800);

      const popup = await openPopup(context, extensionId);
      const before = await waitForState(popup, (s) =>
        s.records.some((record) => record.url.endsWith('/cookie.pdf'))
      );
      const record = before.records.find((item) => item.url.endsWith('/cookie.pdf'))!;

      await popup.evaluate(async (recordId) => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };
        }).chrome;
        await chromeRef.runtime.sendMessage({ type: 'download/start', ids: [recordId] });
      }, record.id);

      const after = await waitForState(
        popup,
        (s) => s.jobs.some((job) => job.recordId === record.id && ['done', 'failed'].includes(job.status)),
        25_000
      );
      const job = after.jobs.find((item) => item.recordId === record.id);
      expect(job?.status).toBe('done');
      expect(job?.errorDetail).toBeUndefined();

      const finalState = await getState(popup);
      expect(finalState.jobs.find((item) => item.id === job!.id)?.status).toBe('done');
    } finally {
      await context.close();
      await server.close();
    }
  });
});

test.describe('bearer auth downloads', () => {
  test('downloads a bearer-authenticated PDF when session reuse is enabled', async () => {
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
      await page.waitForTimeout(800);

      const state = await waitForState(
        popup,
        (s) => s.records.some((record) => record.url.endsWith('/bearer.pdf') && Boolean(record.auth.tokenRef))
      );
      const record = state.records.find((item) => item.url.endsWith('/bearer.pdf'))!;
      expect(record.auth.bearerScheme).toBe('Bearer');
      expect(record.auth.tokenRef).toBe(record.id);

      await popup.evaluate(async (recordId) => {
        const chromeRef = (globalThis as unknown as {
          chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };
        }).chrome;
        await chromeRef.runtime.sendMessage({ type: 'download/start', ids: [recordId] });
      }, record.id);

      const after = await waitForState(
        popup,
        (s) => s.jobs.some((job) => job.recordId === record.id && job.status === 'done'),
        25_000
      );
      expect(after.jobs.find((job) => job.recordId === record.id)?.status).toBe('done');
    } finally {
      await context.close();
      await server.close();
    }
  });
});
