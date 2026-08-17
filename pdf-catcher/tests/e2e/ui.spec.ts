import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchExtension, openPopup, startPdfServer } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../.output/chrome-mv3');

test.describe('popup UI', () => {
  test('renders the new panel, scans, selects, and switches views', async () => {
    const server = await startPdfServer();
    const { context, extensionId } = await launchExtension(extensionPath);
    const page = await context.newPage();

    try {
      await page.goto(`${server.url}/scan.html`);
      const popup = await openPopup(context, extensionId);
      await page.bringToFront();

      await expect(popup.locator('.brand-copy h1')).toContainText('PDF');
      await expect(popup.locator('.view-switch')).toBeVisible();
      await expect(popup.locator('.search-box input')).toBeVisible();

      await popup.locator('.top-actions .icon-button').first().click();
      await expect(popup.locator('.record-card')).toHaveCount(1);
      await expect(popup.locator('.record-card.dom-source')).toHaveCount(1);

      await popup.locator('.record-card .check-control').first().click();
      await expect(popup.locator('.record-card .check-control input').first()).toBeChecked();
      await expect(popup.locator('.batch-bar')).toBeVisible();
      await expect(popup.locator('.batch-bar .count')).toContainText('1');
      await popup.locator('.batch-bar .clear-selection').click();
      await expect(popup.locator('.batch-bar')).toHaveCount(0);

      await popup.locator('.view-switch button').nth(1).click();
      await expect(popup.locator('.empty-state')).toBeVisible();
    } finally {
      await context.close();
      await server.close();
    }
  });
});
