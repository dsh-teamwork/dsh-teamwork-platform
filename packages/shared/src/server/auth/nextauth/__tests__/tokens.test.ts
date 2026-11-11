import { beforeAll, describe, expect, it } from 'vitest';

const verifier = 'v'.repeat(43) + 'erifier-that-is-long-enough';

describe('the plugin hand-off', async () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-a-key';
  });
  const { challengeOf, identityFromBearer, mintHandoffCode, redeemHandoffCode } = await import('../tokens');

  it('trades a code and its verifier for a Bearer token that names the same identity', async () => {
    const code = await mintHandoffCode({ email: 'Ada@Example.com', name: 'Ada', via: 'email' }, challengeOf(verifier));
    const issued = await redeemHandoffCode(code, verifier);
    expect(issued).not.toBeNull();
    expect(await identityFromBearer(issued!.token)).toEqual({
      strategy: 'nextauth',
      subject: 'ada@example.com',
      email: 'ada@example.com',
      via: 'email',
      name: 'Ada',
    });
  });

  it('refuses a code presented with any other verifier — what makes a code read off a screen useless', async () => {
    const code = await mintHandoffCode({ email: 'ada@example.com', via: 'email' }, challengeOf(verifier));
    expect(await redeemHandoffCode(code, `${verifier}x`)).toBeNull();
  });

  it('does not accept a hand-off code as a Bearer token, or the reverse', async () => {
    const code = await mintHandoffCode({ email: 'ada@example.com', via: 'email' }, challengeOf(verifier));
    expect(await identityFromBearer(code)).toBeNull();
    const { token } = (await redeemHandoffCode(code, verifier))!;
    expect(await redeemHandoffCode(token, verifier)).toBeNull();
  });

  it('refuses a token minted under another secret', async () => {
    const code = await mintHandoffCode({ email: 'ada@example.com', via: 'email' }, challengeOf(verifier));
    const { token } = (await redeemHandoffCode(code, verifier))!;
    process.env.AUTH_SECRET = 'a-different-secret-that-is-also-long-enough';
    expect(await identityFromBearer(token)).toBeNull();
    process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-a-key';
  });

  it('carries the door the web session came through into the plugin', async () => {
    const code = await mintHandoffCode({ email: 'ada@example.com', via: 'google' }, challengeOf(verifier));
    const { token } = (await redeemHandoffCode(code, verifier))!;
    expect((await identityFromBearer(token))?.via).toBe('google');
  });
});
