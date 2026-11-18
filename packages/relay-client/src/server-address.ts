/**
 * A server address as the app stores and calls it: https anywhere, plain http
 * only on loopback, no query, fragment or credentials, no trailing slash.
 *
 * It mirrors `serverAddress` in the plugin (dsh-teamwork `src/client.ts`), so
 * the same address typed into DSH and into the app means the same server. The
 * plugin throws a sentence; here the error carries a code, and the screen
 * words it from the locale files.
 */

export type ServerAddressErrorCode = 'invalid' | 'insecure' | 'extra';

export class ServerAddressError extends Error {
  constructor(readonly code: ServerAddressErrorCode) {
    super(code);
    this.name = 'ServerAddressError';
  }
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

export function serverAddress(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ServerAddressError('invalid');
  }
  const loopback = LOOPBACK.includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new ServerAddressError('insecure');
  if (url.search || url.hash || url.username || url.password) throw new ServerAddressError('extra');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
