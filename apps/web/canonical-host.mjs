// One host, not two: the www/apex twin of the deployment's own origin answers
// with a permanent redirect to it (from router9 `apps/web/canonical-host.mjs`).
//
// Serving the app on both hosts breaks sign-in. Auth.js cookies are host-only
// (the `__Host-` ones cannot carry a `Domain` at all), and Google returns to the
// one callback the origin names, so a sign-in begun on the twin arrives without
// its PKCE cookie and fails as a configuration error naming neither.
//
// Evaluated by `next build` and compiled into routes-manifest.json; `next start`
// never re-runs it. So the origin has to be in the build, which turbo's strict
// env mode allows only because turbo.json names it for this task.
//
// It matches the one twin rather than "any host that is not canonical": that
// rule loops as soon as a proxy rewrites Host, and would bounce Railway's own
// hostnames. Doing it at a CDN instead is as valid; this keeps the rule with the
// code that depends on it, on every instance.

/** The origin a stranger may be sent to permanently: https and not loopback, or none. */
function trustedOrigin(raw) {
  const value = raw?.trim();
  if (!value) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') return undefined;
  return url;
}

/**
 * At most one `redirects()` entry: from the twin of the deployment's origin to
 * it, path and query kept. The origin is read in Auth.js's own order here
 * (`AUTH_URL`, then `APP_URL`), so the host it keeps is the one the OAuth
 * callback returns to. 308, so a POST stays a POST.
 */
export function canonicalHostRedirects(env) {
  if (env.NODE_ENV !== 'production') return [];
  const url = trustedOrigin(env.AUTH_URL) ?? trustedOrigin(env.APP_URL);
  if (!url) return [];
  const host = url.hostname;
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return [
    {
      source: '/:path*',
      // Compiled into a regex, so the dots are escaped: `wwwXexample.com` is not the twin.
      has: [{ type: 'host', value: twin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }],
      destination: `${url.origin}/:path*`,
      permanent: true,
    },
  ];
}
