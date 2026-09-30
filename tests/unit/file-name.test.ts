import { describe, expect, it } from 'vitest';
import { buildFileName, sanitizeFileName } from '@/modules/shared/file-name';

describe('sanitizeFileName', () => {
  it('removes illegal path characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd.pdf');
  });

  it('appends .pdf extension', () => {
    expect(sanitizeFileName('report')).toBe('report.pdf');
  });

  it('keeps a single .pdf extension', () => {
    expect(sanitizeFileName('report.PDF')).toBe('report.pdf');
  });

  it('falls back for reserved Windows names', () => {
    expect(sanitizeFileName('con')).toBe('_con.pdf');
  });

  it('falls back for empty input', () => {
    expect(sanitizeFileName('...')).toBe('download.pdf');
  });
});

describe('buildFileName', () => {
  it('uses Content-Disposition first', () => {
    expect(buildFileName('https://example.com/download?id=1', 'attachment; filename="paper.pdf"')).toBe('paper.pdf');
  });

  it('falls back to URL path segment', () => {
    expect(buildFileName('https://example.com/path/lecture.pdf?token=abc')).toBe('lecture.pdf');
  });

  it('appends .pdf when URL path has no extension', () => {
    expect(buildFileName('https://example.com/download')).toBe('download.pdf');
  });
});
