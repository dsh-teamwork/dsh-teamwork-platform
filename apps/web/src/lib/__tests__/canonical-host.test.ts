import { describe, expect, it } from 'vitest';

// next.config.mjs imports the same file, so this is the rule that reaches routes-manifest.json.
import { canonicalHostRedirects } from '../../../canonical-host.mjs';

const prod = (env: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...env });

describe('the canonical-host redirect', () => {
  it('sends www to the apex when the apex is the origin', () => {
    expect(canonicalHostRedirects(prod({ APP_URL: 'https://dshteamwork.com/' }))).toEqual([
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www\\.dshteamwork\\.com' }],
        destination: 'https://dshteamwork.com/:path*',
        permanent: true,
      },
    ]);
  });

  it('sends the apex to www when www is the origin', () => {
    const [rule] = canonicalHostRedirects(prod({ APP_URL: 'https://www.dshteamwork.com' }));
    expect(rule.has[0].value).toBe('dshteamwork\\.com');
    expect(rule.destination).toBe('https://www.dshteamwork.com/:path*');
  });

  it('keeps the host the OAuth callback returns to: AUTH_URL before APP_URL', () => {
    const [rule] = canonicalHostRedirects(prod({ AUTH_URL: 'https://www.dshteamwork.com', APP_URL: 'https://dshteamwork.com' }));
    expect(rule.destination).toBe('https://www.dshteamwork.com/:path*');
  });

  it('matches only the twin, so any other host is served rather than bounced', () => {
    const [rule] = canonicalHostRedirects(prod({ APP_URL: 'https://dshteamwork.com' }));
    const matcher = new RegExp(`^${rule.has[0].value}$`);
    expect(matcher.test('www.dshteamwork.com')).toBe(true);
    for (const host of ['wwwXdshteamwork.com', 'dshteamwork.com', 'manage.dshteamwork.com', 'web-production.up.railway.app']) {
      expect(matcher.test(host)).toBe(false);
    }
  });

  it('emits nothing without a public https origin, or outside production', () => {
    for (const env of [prod(), prod({ APP_URL: 'http://dshteamwork.com' }), prod({ APP_URL: 'https://localhost:3800' }), prod({ APP_URL: 'not a url' })]) {
      expect(canonicalHostRedirects(env)).toEqual([]);
    }
    expect(canonicalHostRedirects({ NODE_ENV: 'development', APP_URL: 'https://dshteamwork.com' })).toEqual([]);
  });
});
