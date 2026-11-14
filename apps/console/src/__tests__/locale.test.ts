import { describe, expect, it } from 'vitest';

import { matchLocale } from '@/lib/locale';
import { isLoopback, returnPath } from '@/lib/return-path';

describe('matchLocale', () => {
  it('reads any Simplified Chinese tag as zh-CN and skips Traditional ones', () => {
    expect(matchLocale(['zh-Hans-CN'])).toBe('zh-CN');
    expect(matchLocale(['zh-TW', 'en-US'])).toBe('en');
    expect(matchLocale(['fr'])).toBe('en');
  });
});

describe('returnPath', () => {
  it('keeps a path on this site and refuses anything that leaves it', () => {
    expect(returnPath('/plugin?challenge=x')).toBe('/plugin?challenge=x');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/a\u0000b', null]) {
      expect(returnPath(bad)).toBe('/teams');
    }
  });
});

describe('isLoopback', () => {
  it('admits only plain http to 127.0.0.1 on an explicit port', () => {
    expect(isLoopback('http://127.0.0.1:5555/callback')).toBe(true);
    for (const bad of ['http://localhost:5555/', 'https://127.0.0.1:5555/', 'http://127.0.0.1/', 'http://u:p@127.0.0.1:1/']) {
      expect(isLoopback(bad)).toBe(false);
    }
  });
});
