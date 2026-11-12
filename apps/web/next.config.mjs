import createNextIntlPlugin from 'next-intl/plugin';

import { canonicalHostRedirects } from './canonical-host.mjs';

// Links `src/i18n/request.ts` into the build. There is no routing half: the
// locale is the viewer's (profile, then cookie, then Accept-Language) and no
// URL carries it.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const config = {
  // Workspace packages ship TypeScript source, not a build.
  transpilePackages: ['@dsh-teamwork/db', '@dsh-teamwork/shared'],
  // Loaded by Node, not bundled: bundled, PGlite's initdb loses its own
  // `instantiateWasm` and a new data directory never initialises (ADR 0006).
  serverExternalPackages: ['@electric-sql/pglite', 'pglite-prisma-adapter'],
  // Nothing a visitor needs, and a free hint about what to attack.
  poweredByHeader: false,
  // Inlined at build, like the legal pages it names (src/lib/legal.ts): the
  // footer and sitemap link them exactly when this build published them, even
  // where the variable is also set, or not, when the server runs.
  env: { LEGAL_DIR: process.env.LEGAL_DIR ?? '' },
  // The www/apex twin of APP_URL redirects to it, or sign-in breaks on the twin
  // (canonical-host.mjs says why).
  async redirects() {
    return canonicalHostRedirects(process.env);
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // No `preload`: that is a one-way door, added once the domain layout
          // has settled.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
