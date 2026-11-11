import { describe, expect, it } from 'vitest';

import { matchLocale } from '../locales';

describe('matchLocale', () => {
  it.each([
    [['zh-CN'], 'zh-CN'],
    [['zh-Hans-CN'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['zh-TW', 'en-US'], 'en'],
    [['fr-FR', 'en-GB'], 'en'],
    [['fr-FR'], 'en'],
    [[], 'en'],
    [null, 'en'],
  ])('%j -> %s', (tags, expected) => {
    expect(matchLocale(tags as string[] | null)).toBe(expected);
  });

  it('reads an Accept-Language header by weight, ignoring q=0', () => {
    expect(matchLocale('en;q=0.5, zh-CN;q=0.9')).toBe('zh-CN');
    expect(matchLocale('zh-CN;q=0, en;q=0.1')).toBe('en');
  });
});
