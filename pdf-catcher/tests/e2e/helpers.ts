import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';


export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export function buildPdf(title = 'PDF Catcher Test'): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${title.length} >>\nstream\n${title}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

export async function startPdfServer(): Promise<TestServer> {
  const pdf = buildPdf();
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, contentType: string, body: Buffer | string) => {
      res.writeHead(status, {
        'content-type': contentType,
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'Authorization'
      });
      res.end(body);
    };

    if (requestUrl.pathname === '/') {
      send(200, 'text/html; charset=utf-8', '<html><body>pdf catcher test home</body></html>');
      return;
    }

    if (requestUrl.pathname === '/set-cookie') {
      res.writeHead(200, {
        'content-type': 'text/html',
        'set-cookie': 'auth=1; Path=/; SameSite=Lax'
      });
      res.end('<html><body>cookie set</body></html>');
      return;
    }

    if (requestUrl.pathname === '/file.pdf') {
      send(200, 'application/pdf', pdf);
      return;
    }

    if (requestUrl.pathname === '/stream') {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename=\"streamed-paper.pdf\""
      });
      res.end(pdf);
      return;
    }

    if (requestUrl.pathname === '/fake.pdf') {
      send(200, 'text/html; charset=utf-8', '<html><body>login page</body></html>');
      return;
    }

    if (requestUrl.pathname === '/cookie.pdf') {
      const hasCookie = Boolean(req.headers.cookie?.includes('auth=1'));
      if (hasCookie) send(200, 'application/pdf', pdf);
      else send(200, 'text/html; charset=utf-8', '<html><body>cookie required</body></html>');
      return;
    }

    if (requestUrl.pathname === '/bearer.pdf') {
      const hasBearer = req.headers.authorization === 'Bearer e2e-secret';
      if (hasBearer) send(200, 'application/pdf', pdf);
      else send(200, 'text/html; charset=utf-8', '<html><body>bearer required</body></html>');
      return;
    }

    send(404, 'text/plain', 'not found');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to start server');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export async function launchExtension(extensionPath: string): Promise<{ context: BrowserContext; extensionId: string }> {
  const userDataDir = path.join(os.tmpdir(), `pdf-catcher-e2e-${Date.now()}-${Math.random()}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
  const extensionId = new URL(serviceWorker.url()).host;

  // 等待 background 完成 storage/捕获监听器初始化，避免过早导航漏采。
  const readyPage = await context.newPage();
  await readyPage.goto(`chrome-extension://${extensionId}/popup.html`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await readyPage.evaluate(async () => {
      const chromeRef = (globalThis as unknown as {
        chrome: { runtime: { sendMessage: (message: unknown) => Promise<{ ok?: boolean }> } };
      }).chrome;
      const response = await chromeRef.runtime.sendMessage({ type: 'state/get' });
      return response?.ok === true;
    });
    if (ready) break;
    await readyPage.waitForTimeout(100);
    if (attempt === 39) throw new Error('background did not become ready');
  }
  await readyPage.close();
  return { context, extensionId };
}

export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

export async function getState(popup: Page): Promise<{
  records: Array<{
    id: string;
    url: string;
    fileName: string;
    confidence: string;
    auth: { cookie: boolean; bearerScheme?: string; bearerTokenRef?: string };
  }>;
  jobs: Array<{ id: string; recordId: string; status: string; errorDetail?: string }>;
  settings: { captureEnabled: boolean };
}> {
  return popup.evaluate(async () => {
    const chromeRef = (globalThis as unknown as {
      chrome: { runtime: { sendMessage: (message: unknown) => Promise<never> } };
    }).chrome;
    const response = await chromeRef.runtime.sendMessage({ type: 'state/get' });
    return response as never;
  });
}

export async function waitForState(
  popup: Page,
  predicate: (state: Awaited<ReturnType<typeof getState>>) => boolean,
  timeoutMs = 15_000
): Promise<Awaited<ReturnType<typeof getState>>> {
  const deadline = Date.now() + timeoutMs;
  let state = await getState(popup);
  while (!predicate(state)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for state. Last state: ${JSON.stringify(state)}`);
    }
    await popup.waitForTimeout(250);
    state = await getState(popup);
  }
  return state;
}
