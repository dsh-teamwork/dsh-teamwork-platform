/**
 * The origin this site is served from, for everything a crawler reads:
 * `metadataBase` (canonical, Open Graph), `robots.txt` and `sitemap.xml`.
 *
 * `APP_URL` only, never the request's Host header: a canonical built from a
 * header is one a stranger can poison. Unset, it is the dev server; set it in
 * every deployment or those tags name localhost.
 */
export function siteOrigin(): string {
  return process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:3800';
}
