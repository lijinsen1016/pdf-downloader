import { describe, expect, it } from 'vitest';
import { hasPdfMagic, isPdfContentType } from '@/modules/shared/pdf-signature';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('hasPdfMagic', () => {
  it('accepts a PDF header', () => {
    expect(hasPdfMagic(bytes('%PDF-1.7\n'))).toBe(true);
  });

  it('tolerates leading whitespace', () => {
    expect(hasPdfMagic(bytes('\r\n  %PDF-1.4'))).toBe(true);
  });

  it('tolerates a UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('%PDF-1.7')]);
    expect(hasPdfMagic(withBom)).toBe(true);
  });

  it('accepts a PDF that starts after padding within the scan window', () => {
    const padded = new Uint8Array([...new Uint8Array(64), ...bytes('%PDF-1.5')]);
    expect(hasPdfMagic(padded)).toBe(true);
  });

  it('rejects HTML impostors', () => {
    expect(hasPdfMagic(bytes('<html><body>login</body></html>'))).toBe(false);
  });

  it('rejects empty and short payloads', () => {
    expect(hasPdfMagic(new Uint8Array())).toBe(false);
    expect(hasPdfMagic(bytes('%PD'))).toBe(false);
  });
});

describe('isPdfContentType', () => {
  it('accepts pdf mime types with parameters', () => {
    expect(isPdfContentType('application/pdf; charset=binary')).toBe(true);
    expect(isPdfContentType('application/x-pdf')).toBe(true);
    expect(isPdfContentType('text/pdf')).toBe(true);
  });

  it('rejects other mime types', () => {
    expect(isPdfContentType('text/html')).toBe(false);
    expect(isPdfContentType(undefined)).toBe(false);
  });
});
