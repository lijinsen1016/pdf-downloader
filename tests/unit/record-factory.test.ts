import { describe, expect, it } from 'vitest';
import {
  buildAuth,
  buildDomRecord,
  buildNetworkRecord,
  buildPostBody,
  bytesToBase64,
  collectAuthHeaders,
  isHostIgnored
} from '@/modules/capture/record-factory';
import type { PendingRequest } from '@/modules/capture/pending-requests';
import { MAX_POST_BODY_BYTES } from '@/modules/shared/types';

type RequestBody = Parameters<typeof buildPostBody>[0];

function pending(patch: Partial<PendingRequest> = {}): PendingRequest {
  return {
    requestId: 'r1',
    url: 'https://example.com/a.pdf',
    tabId: 1,
    method: 'GET',
    createdAt: 0,
    hasCookie: false,
    hasRange: false,
    authHeaderValues: [],
    ...patch
  };
}

describe('collectAuthHeaders', () => {
  it('keeps whitelisted headers and lowercases their names', () => {
    expect(collectAuthHeaders([{ name: 'Authorization', value: 'Bearer t' }], ['authorization'])).toEqual([
      { name: 'authorization', value: 'Bearer t' }
    ]);
    expect(collectAuthHeaders([{ name: 'X-Api-Key', value: 'k' }], ['x-api-key'])).toEqual([
      { name: 'x-api-key', value: 'k' }
    ]);
  });

  it('never collects browser-controlled or privacy-sensitive headers', () => {
    const headers = [
      { name: 'Cookie', value: 'a=1' },
      { name: 'Host', value: 'example.com' },
      { name: 'Origin', value: 'https://example.com' },
      { name: 'Referer', value: 'https://example.com' },
      { name: 'Content-Length', value: '10' }
    ];
    const whitelist = ['cookie', 'host', 'origin', 'referer', 'content-length'];
    expect(collectAuthHeaders(headers, whitelist)).toEqual([]);
  });

  it('ignores headers outside the whitelist', () => {
    expect(collectAuthHeaders([{ name: 'X-Trace', value: '1' }], ['authorization'])).toEqual([]);
  });
});

describe('buildAuth', () => {
  it('records the cookie flag, header names and bearer scheme only', () => {
    const auth = buildAuth(
      pending({
        hasCookie: true,
        authHeaderValues: [{ name: 'authorization', value: 'Bearer secret-token' }]
      })
    );
    expect(auth).toEqual({
      cookie: true,
      authHeaders: ['authorization'],
      bearerScheme: 'Bearer'
    });
    expect(JSON.stringify(auth)).not.toContain('secret-token');
  });

  it('does not treat basic auth as a bearer scheme', () => {
    const auth = buildAuth(
      pending({ authHeaderValues: [{ name: 'authorization', value: 'Basic abc' }] })
    );
    expect(auth.bearerScheme).toBeUndefined();
  });
});

describe('buildPostBody', () => {
  it('keeps form data', () => {
    const body = buildPostBody({ formData: { doc: ['report'] } } as unknown as RequestBody);
    expect(body).toEqual({ kind: 'form', formData: { doc: ['report'] } });
  });

  it('drops bodies above the size cap', () => {
    const oversized = 'x'.repeat(MAX_POST_BODY_BYTES + 1);
    expect(buildPostBody({ formData: { doc: [oversized] } } as unknown as RequestBody)).toBeUndefined();
  });

  it('encodes raw bodies as base64', () => {
    const payload = new TextEncoder().encode('doc=report');
    const body = buildPostBody({
      raw: [{ bytes: payload.buffer as ArrayBuffer }]
    } as unknown as RequestBody);
    expect(body).toMatchObject({ kind: 'raw', base64: bytesToBase64(payload) });
  });

  it('returns undefined for empty bodies', () => {
    expect(buildPostBody(undefined)).toBeUndefined();
    expect(buildPostBody({ formData: {} } as unknown as RequestBody)).toBeUndefined();
  });
});

describe('buildNetworkRecord', () => {
  it('maps captured response details into a record', () => {
    const record = buildNetworkRecord({
      url: 'https://cdn.example.com/stream?id=1',
      finalUrl: 'https://cdn.example.com/final.pdf',
      statusCode: 200,
      method: 'POST',
      tabId: 7,
      response: {
        statusCode: 200,
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="paper.pdf"',
        contentLength: 1024
      },
      verdict: { isPdf: true, confidence: 'high', mime: 'application/pdf' },
      auth: { cookie: true, authHeaders: ['authorization'] },
      partial: true,
      size: 2048
    });

    expect(record).toMatchObject({
      url: 'https://cdn.example.com/stream?id=1',
      finalUrl: 'https://cdn.example.com/final.pdf',
      host: 'cdn.example.com',
      fileName: 'paper.pdf',
      mime: 'application/pdf',
      size: 2048,
      statusCode: 200,
      tabId: 7,
      method: 'POST',
      source: 'network',
      confidence: 'high',
      partial: true
    });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('buildDomRecord', () => {
  it('marks scanned page links as medium confidence', () => {
    const record = buildDomRecord('https://example.com/lecture.pdf?token=1', 3, 123);
    expect(record).toMatchObject({
      host: 'example.com',
      fileName: 'lecture.pdf',
      source: 'dom',
      confidence: 'medium',
      capturedAt: 123,
      tabId: 3,
      method: 'GET'
    });
  });
});

describe('isHostIgnored', () => {
  it('supports exact and wildcard patterns', () => {
    expect(isHostIgnored('example.com', ['example.com'])).toBe(true);
    expect(isHostIgnored('a.example.com', ['*.example.com'])).toBe(true);
    expect(isHostIgnored('example.com', ['*.example.com'])).toBe(false);
    expect(isHostIgnored('other.com', ['example.com'])).toBe(false);
  });

  it('ignores blank patterns', () => {
    expect(isHostIgnored('example.com', ['', '   '])).toBe(false);
  });
});
