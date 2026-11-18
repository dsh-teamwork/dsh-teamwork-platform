/**
 * What the pairing screen accepts. A computer's Teamwork panel shows a code and
 * a QR code for `dshteamwork://pair?server=…&code=…`, which a phone's camera
 * opens in the app; the code can also be typed. A code belongs to the server
 * that issued it, so a link naming another server than the one the member is
 * signed in to is refused rather than redeemed against the wrong one.
 */

import { serverAddress } from './server-address';

/** The code as the relay compares it: letters and digits, upper case. */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whether a link's `server` is the one the member signed in to; a typed code names none and always is. */
export function sameServer(linked: string | undefined, signedIn: string): boolean {
  if (!linked) return true;
  try {
    return serverAddress(linked) === serverAddress(signedIn);
  } catch {
    return false;
  }
}

/** How many characters a pairing code has (`server/relay/pairing.go`, `codeLength`). */
export const PAIRING_CODE_LENGTH = 6;

/** A `dshteamwork://` link's query, read by hand: React Native's URL has no working searchParams. */
function linkQuery(data: string, kind: 'pair' | 'join') {
  const match = new RegExp(`^dshteamwork://${kind}\\?([^#\\s]*)$`).exec(data.trim());
  if (!match) return null;
  const params = new Map<string, string>();
  for (const part of match[1]!.split('&')) {
    const [name, value = ''] = part.split('=');
    try {
      params.set(decodeURIComponent(name!), decodeURIComponent(value.replace(/\+/g, ' ')));
    } catch {
      return null;
    }
  }
  return params;
}

/**
 * A shared DSH's invite (the server's `docs/tech/shared-dsh.md`, "Pairing by invite"), as its admin hands it over:
 * `dshteamwork://join?server=…&host=…&key=…&invite=…&secret=…`, or null when it is not one. The key is the DSH's, pinned
 * for the handshake; the secret is given only to that DSH.
 */
export function joinLink(data: string): { server: string; host: string; key: string; invite: string; secret: string } | null {
  const params = linkQuery(data, 'join');
  if (!params) return null;
  const [server, host, key, invite, secret] = ['server', 'host', 'key', 'invite', 'secret'].map((name) => params.get(name) ?? '');
  if (!server || !host || !key || !invite || !secret || [host, invite, secret].some((v) => v.length > 100)) return null;
  return { server, host, key, invite, secret };
}

/**
 * What a scanned QR code holds, or null when it is not a pairing link. The
 * panel draws `dshteamwork://pair?server=…&code=…&key=…`; React Native's URL
 * has no working searchParams, so the query is read by hand.
 */
export function pairingLink(data: string): { code: string; server?: string; key?: string } | null {
  const params = linkQuery(data, 'pair');
  if (!params) return null;
  const code = normalizePairingCode(params.get('code') ?? '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  return { code, server: params.get('server') || undefined, key: params.get('key') || undefined };
}
