import { describe, expect, it } from 'vitest';
import {
  OffscreenFetchError,
  isPdfVerificationError,
  toOffscreenError
} from '@/modules/downloads/offscreen-errors';

describe('isPdfVerificationError', () => {
  it('is true only for the not-pdf category', () => {
    expect(isPdfVerificationError(new OffscreenFetchError('nope', 'not-pdf'))).toBe(true);
    expect(isPdfVerificationError(new OffscreenFetchError('boom', 'network'))).toBe(false);
    expect(isPdfVerificationError(new OffscreenFetchError('404', 'http'))).toBe(false);
    expect(isPdfVerificationError(new Error('plain'))).toBe(false);
    expect(isPdfVerificationError(undefined)).toBe(false);
  });
});

describe('toOffscreenError', () => {
  it('maps the wire errorCode to the typed error', () => {
    expect(toOffscreenError({ error: 'response is not a PDF', errorCode: 'not-pdf' }).code).toBe(
      'not-pdf'
    );
    expect(toOffscreenError({ error: 'HTTP 500', errorCode: 'http' }).code).toBe('http');
  });

  it('falls back to network for missing or unknown codes', () => {
    expect(toOffscreenError({ error: 'x' }).code).toBe('network');
    expect(toOffscreenError({ error: 'x', errorCode: 'weird' }).code).toBe('network');
  });
});
