import { describe, expect, it } from 'vitest';
import { classifyPdf } from '@/modules/shared/classifier';

const base = { method: 'GET', statusCode: 200 };

describe('classifyPdf', () => {
  it('detects application/pdf without a .pdf URL', () => {
    const verdict = classifyPdf({
      ...base,
      url: 'https://example.com/stream?id=1',
      contentType: 'application/pdf; charset=binary'
    });
    expect(verdict).toMatchObject({ isPdf: true, confidence: 'high', source: 'content-type' });
  });

  it('rejects .pdf URLs that return HTML', () => {
    const verdict = classifyPdf({
      ...base,
      url: 'https://example.com/fake.pdf',
      contentType: 'text/html; charset=utf-8'
    });
    expect(verdict).toEqual({ isPdf: false, reason: 'non-pdf-content-type' });
  });

  it('detects PDFs from Content-Disposition filename', () => {
    const verdict = classifyPdf({
      ...base,
      url: 'https://example.com/download',
      contentType: 'application/octet-stream',
      contentDisposition: "attachment; filename=\"paper.pdf\""
    });
    expect(verdict).toMatchObject({ isPdf: true, confidence: 'high', source: 'content-disposition' });
  });

  it('accepts octet-stream only when URL ends with .pdf', () => {
    const verdict = classifyPdf({
      ...base,
      url: 'https://example.com/doc.pdf',
      contentType: 'application/octet-stream'
    });
    expect(verdict).toMatchObject({ isPdf: true, confidence: 'medium', source: 'url-extension' });
  });

  it('rejects octet-stream without any PDF signal', () => {
    const verdict = classifyPdf({
      ...base,
      url: 'https://example.com/download',
      contentType: 'application/octet-stream'
    });
    expect(verdict).toEqual({ isPdf: false, reason: 'no-pdf-signal' });
  });

  it('rejects non-2xx responses', () => {
    const verdict = classifyPdf({
      method: 'GET',
      statusCode: 404,
      url: 'https://example.com/doc.pdf',
      contentType: 'application/pdf'
    });
    expect(verdict).toEqual({ isPdf: false, reason: 'non-2xx' });
  });

  it('rejects non-GET methods', () => {
    const verdict = classifyPdf({
      method: 'POST',
      statusCode: 200,
      url: 'https://example.com/doc.pdf',
      contentType: 'application/pdf'
    });
    expect(verdict).toEqual({ isPdf: false, reason: 'non-get' });
  });
});
