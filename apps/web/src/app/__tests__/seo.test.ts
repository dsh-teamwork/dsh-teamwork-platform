import { afterEach, describe, expect, it, vi } from 'vitest';

import robots from '../robots';
import sitemap from '../sitemap';

afterEach(() => vi.unstubAllEnvs());

describe('crawler files', () => {
  it('names the sitemap from APP_URL, without a trailing slash', () => {
    vi.stubEnv('APP_URL', 'https://example.com/');
    expect(robots().sitemap).toBe('https://example.com/sitemap.xml');
  });

  it('lists the public pages and none of the signed-in ones', () => {
    vi.stubEnv('APP_URL', 'https://example.com');
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual(['https://example.com']);
  });

  it('keeps a page out of the sitemap only if robots.txt also refuses the path it lives on', () => {
    const rules = robots().rules;
    const disallow = ([] as string[]).concat(...[rules].flat().map((r) => r.disallow ?? []));
    for (const path of ['/account', '/api/', '/auth/', '/team', '/plugin']) expect(disallow).toContain(path);
  });
});
