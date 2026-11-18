import { describe, expect, it } from 'vitest';
import { webAesKey } from '../aes-gcm';
import { base64, deviceIdentity, SecureChannel, type Identity, type SecurePacket } from '../secure-channel';
import { newWebCryptoKeyPair, webCryptoIdentity } from '../web-identity';

const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Two channel ends wired to each other, each packet delivered later as a socket would; resolves with what each received once both are ready. */
async function handshake(phone: Identity, host: Identity) {
  const random = randomBytes;
  const got: { phone: unknown[]; host: unknown[] } = { phone: [], host: [] };
  let a!: SecureChannel, b!: SecureChannel;
  let ready = 0;
  // Resolved once each end has its one message: a fixed wait lost them when the suite ran under load.
  let delivered!: () => void;
  const arrived = new Promise<void>((resolve) => { delivered = resolve; });
  const received = () => { if (got.phone.length && got.host.length) delivered(); };
  const both = new Promise<void>((resolve, reject) => {
    const common = { pairingId: 'p1', channelId: 'abcdefghijklmnopqrstuv', random, importAesKey: webAesKey, closed: (error: Error) => reject(error) };
    a = new SecureChannel({ ...common, initiator: true, identity: phone, expectedKey: host.publicKey, send: (f: SecurePacket) => setTimeout(() => b.receive(f), 0), ready: () => { if (++ready === 2) resolve(); }, message: (v) => { got.phone.push(v); received(); } });
    b = new SecureChannel({ ...common, initiator: false, identity: host, expectedKey: phone.publicKey, send: (f: SecurePacket) => setTimeout(() => a.receive(f), 0), ready: () => { if (++ready === 2) resolve(); }, message: (v) => { got.host.push(v); received(); } });
  });
  a.start();
  b.start();
  await both;
  a.send({ hello: 'host' });
  b.send({ hello: 'phone' });
  await arrived;
  a.close();
  b.close();
  return got;
}

describe('a browser identity', () => {
  it('completes the pinned handshake with a DSH, signing with a key no script can read', async () => {
    const pair = await newWebCryptoKeyPair();
    await expect(globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    const browser = await webCryptoIdentity(pair);
    expect((await webCryptoIdentity(pair)).publicKey).toBe(browser.publicKey);
    const got = await handshake(browser, await deviceIdentity(base64(randomBytes(32))));
    expect(got).toEqual({ phone: [{ hello: 'phone' }], host: [{ hello: 'host' }] });
  });

  it('fails the handshake when the DSH expects another key', async () => {
    const browser = await webCryptoIdentity(await newWebCryptoKeyPair());
    const host = await deviceIdentity(base64(randomBytes(32)));
    const impostor = { ...browser, publicKey: (await deviceIdentity(base64(randomBytes(32)))).publicKey };
    await expect(handshake(impostor, host)).rejects.toThrow();
  });
});
