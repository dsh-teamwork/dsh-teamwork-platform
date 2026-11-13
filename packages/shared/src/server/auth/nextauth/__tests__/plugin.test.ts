import { afterEach, describe, expect, it } from 'vitest';

import { createPluginHandoff } from '../plugin';

/** Where a code may be sent instead of shown (docs/adr/0010-the-app-gets-its-code-back.md). */
describe('the hand-off’s return address', () => {
  const { returnTo } = createPluginHandoff(async () => null);
  afterEach(() => { delete process.env.MOBILE_REDIRECT_URI; });

  it('sends a code nowhere while MOBILE_REDIRECT_URI is unset', () => {
    expect(returnTo('dshteamwork://sign-in')).toBeNull();
  });

  it('accepts only an address under the configured prefix', () => {
    process.env.MOBILE_REDIRECT_URI = 'dshteamwork://sign-in';
    expect(returnTo('dshteamwork://sign-in')).toBe('dshteamwork://sign-in');
    for (const uri of ['https://evil.example/sign-in', 'dshteamwork://other', 'evil://dshteamwork://sign-in', '', ['dshteamwork://sign-in'], undefined]) {
      expect(returnTo(uri)).toBeNull();
    }
  });
});
