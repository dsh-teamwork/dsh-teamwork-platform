/**
 * The origin a visitor is actually on, for building absolute URLs a browser or
 * an identity provider will be sent back to.
 *
 * `APP_URL` wins when set. Otherwise the forwarded headers, never the request
 * URL: behind Railway's proxy that is the container's own address, and a
 * redirect built from it sends people somewhere that does not exist. Getting
 * the host right also matters for sign-in, because the cookies an OAuth start
 * writes are host-only — send somebody back to `www.` after starting on the
 * apex and the callback cannot finish.
 */
export function requestOrigin(headers: Headers): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3800';
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]!.trim()}://${host.split(',')[0]!.trim()}`;
}
