/**
 * Where to go after signing in: a path on this site, or `fallback`. Anything
 * that could leave the origin — a scheme, `//host`, a backslash a browser
 * reads as a slash, a control character — is the fallback: a sign-in page
 * that goes wherever its query says is how a phishing link borrows a name.
 */
export function returnPath(asked: string | null | undefined, fallback = '/teams'): string {
  if (!asked || asked.length > 512 || !asked.startsWith('/') || asked.startsWith('//')) return fallback;
  if ([...asked].some((c) => c === '\\' || c.charCodeAt(0) < 0x20)) return fallback;
  const here = 'https://return.invalid';
  const url = new URL(asked, here);
  return url.origin === here ? `${url.pathname}${url.search}${url.hash}` : fallback;
}

/** RFC 8252 §7.3: plain http to the IPv4 loopback literal, on an explicit port. */
export function isLoopback(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}
