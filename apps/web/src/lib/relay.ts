/**
 * The console as a relay client (docs/tech/shared-dsh.md, "Clients"): the same live client the phone app runs, here
 * on this site's own origin, so the session cookie admits it and no token is held in the page. Its keys live in this
 * browser's IndexedDB, per account: the E2EE identity a non-extractable WebCrypto Ed25519 key, the relay credential
 * that admits this browser as a handset, and each DSH's pinned key. Clearing the site's data forgets them, and the
 * browser then joins again by a new invite.
 */
import {
  base64,
  createLiveRelay,
  newWebCryptoKeyPair,
  webCryptoIdentity,
  type DeviceKeys,
  type Identity,
  type RelayClient,
} from '@dsh-teamwork/relay-client';

import type { Schemas } from './api';
import { currentLocale } from './locale';

const DB = 'dsh-teamwork-relay';
const STORE = 'keys';

function request<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => { resolve(req.result); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    };
  });
}
const read = <T>(key: string) => request<T | undefined>((s) => s.get(key) as IDBRequest<T | undefined>, 'readonly');
const write = (key: string, value: unknown) => request((s) => s.put(value, key), 'readwrite').then(() => undefined);
const remove = (key: string) => request((s) => s.delete(key), 'readwrite').then(() => undefined);

/** One account's keys in this browser. */
export class BrowserKeys implements DeviceKeys {
  private identityValue?: Promise<Identity>;
  private relayKeyValue?: Promise<string>;
  constructor(private readonly account: string) {}

  identity() {
    return (this.identityValue ??= (async () => {
      const key = `${this.account}:identity`;
      let pair = await read<CryptoKeyPair>(key);
      if (!pair) {
        pair = await newWebCryptoKeyPair();
        await write(key, pair);
      }
      return webCryptoIdentity(pair);
    })());
  }

  relayKey() {
    return (this.relayKeyValue ??= (async () => {
      const key = `${this.account}:relay`;
      let value = await read<string>(key);
      if (!value) {
        value = base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await write(key, value);
      }
      return value;
    })());
  }

  peer(id: string) { return read<string>(`${this.account}:peer:${id}`); }
  trust(id: string, key: string) { return write(`${this.account}:peer:${id}`, key); }
  forget(id: string) { return remove(`${this.account}:peer:${id}`); }
}

let current: { account: string; relay: RelayClient } | undefined;

/** The relay client for the signed-in account; another account's is ended first. */
export function relayFor(account: string): RelayClient {
  if (current?.account === account) return current.relay;
  current?.relay.reset();
  const relay = createLiveRelay({
    keys: new BrowserKeys(account),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    session: async () => ({ server: window.location.origin }),
    locale: currentLocale,
  });
  current = { account, relay };
  return relay;
}

/** Whether this browser can hold the key the channel needs: WebCrypto Ed25519 and IndexedDB. */
export async function browserCanJoin(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) return false;
  try {
    await newWebCryptoKeyPair();
    return true;
  } catch {
    return false;
  }
}

export type MyComputer = Schemas['RelayHost'];

/**
 * The member's own computers, most recently seen first, each with every device paired to it (`GET /relay/hosts`, ADR
 * 0048). This browser's handset credential goes along so its own pairings come back marked `current`.
 */
export async function myComputers(account: string): Promise<MyComputer[]> {
  let key: string | undefined;
  try {
    key = await new BrowserKeys(account).relayKey();
  } catch {
    // A browser that cannot keep keys has no pairing of its own to mark.
  }
  const response = await fetch('/relay/hosts', { credentials: 'same-origin', headers: key ? { 'x-device-key': key } : {} });
  if (!response.ok) throw new Error(`relay hosts: ${response.status}`);
  return ((await response.json()) as { hosts: MyComputer[] }).hosts;
}

/**
 * Cuts another device off one of the member's own computers (ADR 0048): through the relay alone, as for an offline
 * desktop, which drops that device's trust the next time it lists its pairings. This browser's own pairing goes
 * through `RelayClient.revokeComputer` instead, which tells the desktop first.
 */
export async function removeDevice(pairingId: string): Promise<void> {
  const response = await fetch(`/relay/pairings/${encodeURIComponent(pairingId)}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok && response.status !== 404) throw new Error(`remove device: ${response.status}`);
}
