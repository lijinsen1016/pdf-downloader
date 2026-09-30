import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPopup, startPdfServer, waitForState } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

test.describe('enhanced auth capture', () => {
  test('captures and replays custom request headers', async () => {
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
          patch: {
            reuseAuthorization: true,
            reusableHeaders: ['authorization', 'x-api-key']
          }
        });
        if (!response.ok) throw new Error('failed to update settings');
      });

      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/custom-header.pdf', { headers: { 'X-Api-Key': 'e2e-key' } });
      });
      await page.waitForTimeout(600);

      const state = await waitForState(
        popup,
        (s) => s.records.some((record) => record.url.endsWith('/custom-header.pdf'))
      );
      const record = state.records.find((item) => item.url.endsWith('/custom-header.pdf'))!;
      expect(record.auth.authHeaders).toContain('x-api-key');
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

  test('captures and replays POST-generated PDFs', async () => {
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
          patch: { capturePostPdf: true }
        });
        if (!response.ok) throw new Error('failed to update settings');
      });

      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'doc=report'
        });
      });
      await page.waitForTimeout(800);

      const state = await waitForState(
        popup,
        (s) => s.records.some((record) => record.url.endsWith('/generate'))
      );
      const record = state.records.find((item) => item.url.endsWith('/generate'))!;
      expect(record.method).toBe('POST');
      expect(record.fileName).toBe('generated-report.pdf');

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
      const job = after.jobs.find((item) => item.recordId === record.id);
      expect(job?.status).toBe('done');
      expect(job?.errorDetail).toBeUndefined();
    } finally {
      await context.close();
      await server.close();
    }
  });
});
