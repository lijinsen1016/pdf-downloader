import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPopup, startPdfServer, waitForState } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

test.describe('capture engine', () => {
  test('captures PDFs by content type and ignores HTML impostors', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/`);
      await page.evaluate(async () => {
        await fetch('/file.pdf');
        await fetch('/fake.pdf');
        await fetch('/stream?id=1');
      });
      await page.waitForTimeout(800);

      const popup = await openPopup(context, extensionId);
      const state = await waitForState(
        popup,
        (s) =>
          s.records.some((record) => record.url.endsWith('/file.pdf')) &&
          s.records.some((record) => record.url.includes('/stream'))
      );

      expect(state.records.find((record) => record.url.endsWith('/file.pdf'))).toMatchObject({
        fileName: 'file.pdf',
        confidence: 'high'
      });
      expect(state.records.find((record) => record.url.includes('/stream'))).toMatchObject({
        fileName: 'streamed-paper.pdf',
        confidence: 'high'
      });
      expect(state.records.some((record) => record.url.endsWith('/fake.pdf'))).toBe(false);
    } finally {
      await context.close();
      await server.close();
    }
  });

  test('records cookie and bearer auth flags without storing cookie values', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/set-cookie`);
      await page.evaluate(async () => {
        await fetch('/cookie.pdf');
        await fetch('/bearer.pdf', { headers: { Authorization: 'Bearer e2e-secret' } });
      });
      await page.waitForTimeout(800);

      const popup = await openPopup(context, extensionId);
      const state = await waitForState(
        popup,
        (s) =>
          s.records.some((record) => record.url.endsWith('/cookie.pdf')) &&
          s.records.some((record) => record.url.endsWith('/bearer.pdf'))
      );

      expect(state.records.find((record) => record.url.endsWith('/cookie.pdf'))?.auth).toMatchObject({
        cookie: true
      });
      expect(state.records.find((record) => record.url.endsWith('/bearer.pdf'))?.auth).toMatchObject({
        cookie: true,
        bearerScheme: 'Bearer'
      });
    } finally {
      await context.close();
      await server.close();
    }
  });
});
