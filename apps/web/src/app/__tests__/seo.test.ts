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
    vi.stubEnv('LEGAL_DIR', '');
    expect(sitemap().map((e) => e.url)).toEqual(['https://example.com']);
  });

  it('lists the legal pages only where the deployment publishes them', () => {
    vi.stubEnv('APP_URL', 'https://example.com');
    vi.stubEnv('LEGAL_DIR', 'docs/legal');
    expect(sitemap().map((e) => e.url)).toEqual(['https://example.com', 'https://example.com/privacy', 'https://example.com/terms']);
  });

  it('keeps a page out of the sitemap only if robots.txt also refuses the path it lives on', () => {
    const rules = robots().rules;
    const disallow = ([] as string[]).concat(...[rules].flat().map((r) => r.disallow ?? []));
    for (const path of ['/account', '/api/', '/auth/', '/teams', '/plugin']) expect(disallow).toContain(path);
  });
});
