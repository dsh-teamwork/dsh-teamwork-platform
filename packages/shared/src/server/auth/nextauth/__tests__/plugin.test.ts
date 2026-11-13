import { afterEach, describe, expect, it } from 'vitest';

import { createPluginHandoff } from '../plugin';

/** Where a code may be sent instead of shown (docs/adr/0010-the-app-gets-its-code-back.md, docs/adr/0012-the-plugin-gets-its-code-back-on-loopback.md). */
describe('the hand-off’s return address', () => {
  const { returnTo } = createPluginHandoff(async () => null);
  afterEach(() => { delete process.env.MOBILE_REDIRECT_URI; });

  it('sends a code nowhere while MOBILE_REDIRECT_URI is unset', () => {
    expect(returnTo('dshteamwork://sign-in')).toBeNull();
  });

  it('accepts only an address under the configured prefix', () => {
    process.env.MOBILE_REDIRECT_URI = 'dshteamwork://sign-in';
    expect(returnTo('dshteamwork://sign-in')).toEqual({ url: 'dshteamwork://sign-in', to: 'app' });
    for (const uri of ['https://evil.example/sign-in', 'dshteamwork://other', 'evil://dshteamwork://sign-in', '', ['dshteamwork://sign-in'], undefined]) {
      expect(returnTo(uri)).toBeNull();
    }
  });

  it('accepts the plugin’s loopback listener on any port, and nothing that only looks like it', () => {
    expect(returnTo('http://127.0.0.1:53124/callback')).toEqual({ url: 'http://127.0.0.1:53124/callback', to: 'dsh' });
    for (const uri of [
      'http://127.0.0.1/callback',
      'https://127.0.0.1:53124/callback',
      'http://localhost:53124/callback',
      'http://[::1]:53124/callback',
      'http://127.0.0.1:53124@evil.example/callback',
      'http://user:pass@127.0.0.1:53124/callback',
      'http://127.0.0.1.evil.example:53124/callback',
      'http://127.0.0.2:53124/callback',
    ]) {
      expect(returnTo(uri)).toBeNull();
    }
  });
});
