import { describe, expect, it } from 'vitest';
import { getHost, isHttpUrl, normalizeUrl, pathEndsWithPdf } from '@/modules/shared/url';

describe('url utils', () => {
  it('normalizes fragment away', () => {
    expect(normalizeUrl('https://example.com/a.pdf#page=2')).toBe('https://example.com/a.pdf');
  });

  it('keeps query parameters', () => {
    expect(normalizeUrl('https://example.com/a.pdf?id=1#page=2')).toBe('https://example.com/a.pdf?id=1');
  });

  it('gets host', () => {
    expect(getHost('https://cdn.example.com/path/a.pdf')).toBe('cdn.example.com');
  });

  it('detects pdf path', () => {
    expect(pathEndsWithPdf('https://example.com/a.PDF')).toBe(true);
    expect(pathEndsWithPdf('https://example.com/stream?id=a.pdf')).toBe(false);
  });

  it('rejects non-http urls', () => {
    expect(isHttpUrl('chrome://settings')).toBe(false);
    expect(isHttpUrl('https://example.com')).toBe(true);
  });
});
