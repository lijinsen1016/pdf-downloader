import { describe, expect, it } from 'vitest';
import { PendingRequestStore, parseContentRangeTotal } from '@/modules/capture/pending-requests';
import { PENDING_TTL_MS } from '@/modules/shared/types';

describe('parseContentRangeTotal', () => {
  it('parses the total size from a content-range header', () => {
    expect(parseContentRangeTotal('bytes 0-1023/204800')).toBe(204800);
    expect(parseContentRangeTotal('bytes */204800')).toBeUndefined();
  });

  it('rejects malformed values', () => {
    expect(parseContentRangeTotal(undefined)).toBeUndefined();
    expect(parseContentRangeTotal('items 0-1/2')).toBeUndefined();
    expect(parseContentRangeTotal('bytes 0-1/0')).toBeUndefined();
  });
});

describe('PendingRequestStore', () => {
  const pending = (requestId: string, createdAt: number) => ({
    requestId,
    url: 'https://example.com/a.pdf',
    tabId: 1,
    method: 'GET',
    createdAt,
    hasCookie: false,
    hasRange: false,
    authHeaderValues: []
  });

  it('stores and deletes pending requests', () => {
    const store = new PendingRequestStore();
    store.set(pending('a', 1));
    expect(store.get('a')?.url).toBe('https://example.com/a.pdf');
    expect(store.size).toBe(1);
    store.delete('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('sweeps entries older than the TTL', () => {
    const store = new PendingRequestStore();
    const now = 1_000_000;
    store.set(pending('fresh', now - 1000));
    store.set(pending('stale', now - PENDING_TTL_MS - 1));

    store.sweep(now);

    expect(store.get('fresh')).toBeDefined();
    expect(store.get('stale')).toBeUndefined();
  });
});
