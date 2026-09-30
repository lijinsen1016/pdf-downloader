import { describe, expect, it } from 'vitest';
import { parseContentDisposition } from '@/modules/shared/content-disposition';

describe('parseContentDisposition', () => {
  it('parses quoted filename', () => {
    expect(parseContentDisposition('attachment; filename="report.pdf"').filename).toBe('report.pdf');
  });

  it('parses RFC 5987 filename*', () => {
    const result = parseContentDisposition("attachment; filename*=UTF-8''%E8%AF%BE%E4%BB%B6.pdf");
    expect(result.filename).toBe('课件.pdf');
  });

  it('prefers filename* over filename', () => {
    const result = parseContentDisposition(
      "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''real.pdf"
    );
    expect(result.filename).toBe('real.pdf');
  });

  it('returns undefined for missing filename', () => {
    expect(parseContentDisposition('attachment').filename).toBeUndefined();
  });
});
