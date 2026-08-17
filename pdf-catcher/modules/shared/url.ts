export function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** 去掉 fragment，保留 query。用于记录去重。 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function pathEndsWithPdf(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}
