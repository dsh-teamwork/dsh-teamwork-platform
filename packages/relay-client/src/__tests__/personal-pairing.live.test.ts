// A browser-shaped client pairs with a real plugin's own pairing code, end to end through a real relay: the code, the
// safety code compared on both sides, the desktop's approval, then a confirmed, trusted computer. Run by
// server/e2e (personal_pairing_test.go), which starts the server and names it; skipped otherwise.
import { expect, test } from 'vitest';

import { createLiveRelay } from '../live';
import { newWebCryptoKeyPair, webCryptoIdentity } from '../web-identity';

// The Go harness names the server, a member's token, the plugin's checkout and a directory of its own.
const { BASE, TOKEN, PLUGIN, DIR } = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const until = async <T>(what: string, check: () => T | Promise<T>) => {
  for (let i = 0; i < 500; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};

test.skipIf(!BASE)('a browser pairs with a personal computer and the pairing confirms', async () => {
  const lib = (name: string) => import(/* @vite-ignore */ `file://${PLUGIN}/lib/${name}`);
  const { RelayLink } = await lib('relay.js');
  const { PhoneKeys, PhoneSecurity } = await lib('phone-security.js');

  // The desktop, wired as the plugin wires it (src/index.ts).
  // eslint-disable-next-line prefer-const -- the security's callbacks read it, once assigned below.
  let link: { send(frame: unknown): void; request(frame: unknown): Promise<any>; refresh(): void; stop(): void; status: string; host?: string };
  const security = new PhoneSecurity({
    keys: new PhoneKeys(`${DIR}/phone-keys.json`),
    scope: async () => `${BASE}|me`,
    send: (frame: unknown) => link.send(frame),
    forward: () => {},
    confirm: async (id: string) => { await link.request({ t: 'decide', pairingId: id, accept: true }); },
    changed: () => {},
    error: (error: Error) => console.error('desktop:', error.message),
  });
  link = new RelayLink({
    endpoint: () => BASE, token: () => TOKEN, clientIdPath: `${DIR}/cache.host.json`, name: 'laptop', dshVersion: 'e2e',
    onEvent: () => {}, onForward: (frame: never) => void security.handle(frame),
  });
  link.refresh();
  await until('the desktop to connect', () => link.status === 'connected');

  // The browser, with the console's keys kept in memory.
  const pair = await newWebCryptoKeyPair();
  const peers = new Map<string, string>();
  const relay = createLiveRelay({
    keys: {
      identity: () => webCryptoIdentity(pair),
      relayKey: async () => 'B'.repeat(43),
      peer: async (id) => peers.get(id),
      trust: async (id, key) => { peers.set(id, key); },
      forget: async (id) => { peers.delete(id); },
    },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    session: async () => ({ server: BASE!, token: TOKEN }),
    locale: () => 'en',
    device: 'web',
  });

  const offer = await link.request({ t: 'offer' });
  security.offerCode(offer.expiresAt);
  const pairing = await relay.pair(offer.code, 'Web browser');
  const code = await until('the browser safety code', async () => (await relay.getPairing(pairing.id))?.safetyCode);
  // Each end draws its code once its own half of the handshake is done; the browser's may come first.
  expect(await until('the desktop safety code', async () => security.status(pairing.id).safetyCode)).toBe(code);

  await relay.confirmPairing(pairing.id);
  await until('the desktop to hear the browser confirm', () => security.status(pairing.id).phoneConfirmed);
  await security.approve(pairing.id);

  await until('the browser to see the pairing confirmed', async () => (await relay.getPairing(pairing.id))?.status === 'confirmed');
  expect((await relay.listComputers()).map((c) => [c.id, c.hostId])).toEqual([[pairing.id, link.host]]);
  // The browser said what it is, and the desktop keeps it beside its name.
  expect(await security.details(pairing.id)).toMatchObject({ deviceName: 'Web browser', deviceKind: 'web' });
  link.stop();
}, 30_000);
