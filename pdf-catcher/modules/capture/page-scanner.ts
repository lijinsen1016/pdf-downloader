export interface DomPdfLink {
  url: string;
}

/**
 * 在目标页面的隔离世界中执行。保持无外部闭包依赖，便于 chrome.scripting 序列化。
 */
export function collectPdfLinks(): DomPdfLink[] {
  const seen = new Set<string>();
  const results: DomPdfLink[] = [];

  const add = (raw: string) => {
    if (!raw || results.length >= 200) return;
    try {
      const absolute = new URL(raw, document.baseURI);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return;
      if (!absolute.pathname.toLowerCase().endsWith('.pdf')) return;
      if (seen.has(absolute.href)) return;
      seen.add(absolute.href);
      results.push({ url: absolute.href });
    } catch {
      // 忽略无法解析的地址
    }
  };

  document.querySelectorAll('a[href]').forEach((element) => {
    add((element as HTMLAnchorElement).href);
  });
  document.querySelectorAll('iframe[src], object[data], embed[src]').forEach((element) => {
    const source = element.getAttribute('src') ?? element.getAttribute('data');
    if (source) add(source);
  });

  return results;
}
