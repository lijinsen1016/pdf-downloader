# PDF Catcher

A Chrome MV3 extension that captures PDF documents from web requests and downloads them reliably.

## Design highlights

- PDF detection is based on `onHeadersReceived`: `Content-Type`, `Content-Disposition`, then URL extension as a fallback.
- No content script is injected. Downloads run from the extension context through `chrome.downloads`.
- Cookie-auth and Bearer-auth PDFs use an offscreen document fetch fallback and are verified to still be `application/pdf` before saving.
- Records are stored in `chrome.storage.session`; cookie values and full request headers are never persisted. Authorization headers can be reused only when explicitly enabled, and are stored in session memory only.

## Commands

```bash
pnpm install
pnpm dev                 # watch mode
pnpm build               # .output/chrome-mv3
pnpm zip                 # .output/pdf-catcher-<version>-chrome.zip
pnpm check               # lint + typecheck + unit tests + build
pnpm test:e2e            # Playwright E2E (requires a display)
pnpm test:e2e:linux      # headless Linux via xvfb
```

## Load the extension

1. `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Choose **Load unpacked** and select `.output/chrome-mv3`
