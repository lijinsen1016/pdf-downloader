import { parseContentDisposition } from './content-disposition';

// eslint-disable-next-line no-control-regex
const ILLEGAL_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFileName(name: string): string {
  const pathless = name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? name;
  const cleaned = pathless
    .normalize('NFKC')
    .replace(ILLEGAL_FILE_CHARS, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'download.pdf';
  }

  const stem = cleaned.replace(/\.pdf$/i, '');
  const base = stem || 'download';
  const safeBase = RESERVED_WINDOWS_NAMES.test(base) ? `_${base}` : base;
  return `${safeBase.slice(0, 180)}.pdf`;
}

function fromUrlPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    if (!segment || segment === '.') return undefined;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // 保留原始编码值
    }
    return decoded;
  } catch {
    return undefined;
  }
}

export function buildFileName(url: string, contentDisposition?: string): string {
  const dispositionName = parseContentDisposition(contentDisposition).filename;
  const rawName = dispositionName || fromUrlPath(url) || 'download.pdf';
  return sanitizeFileName(rawName);
}

export function looksLikePdfFileName(name: string | undefined): boolean {
  return Boolean(name && /\.pdf$/i.test(name.trim()));
}
