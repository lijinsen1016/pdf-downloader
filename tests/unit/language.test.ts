import { describe, expect, it } from 'vitest';
import { detectLanguage } from '@/modules/shared/language';

describe('detectLanguage', () => {
  it('maps zh variants to zh-CN', () => {
    expect(detectLanguage('zh-CN')).toBe('zh-CN');
    expect(detectLanguage('zh-TW')).toBe('zh-CN');
    expect(detectLanguage('ZH')).toBe('zh-CN');
  });

  it('falls back to en for other languages', () => {
    expect(detectLanguage('en-US')).toBe('en');
    expect(detectLanguage('fr')).toBe('en');
    expect(detectLanguage('')).toBe('en');
  });

  it('always returns a supported language when no argument is given', () => {
    expect(['zh-CN', 'en']).toContain(detectLanguage());
  });
});
