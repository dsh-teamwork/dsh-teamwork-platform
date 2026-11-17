import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// `pnpm dev` serves the web app on :3800 and sends /api to the Go server on
// :3801. Start that one with APP_URL=http://localhost:3800: a write must come
// from APP_URL's origin, and the session cookie belongs to it.
//
// The build has a second entry, the public pages' script; the manifest tells
// scripts/prerender.mjs its file and the console's stylesheet.
function publicPages(): Plugin {
  return {
    name: 'public-pages',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
        const home = path === '/';
        const doc = path === '/docs' ? 'index' : path.startsWith('/docs/') ? path.slice(6) : null;
        const legalPage = path === '/privacy' || path === '/terms' ? path.slice(1) : null;
        if (!home && doc === null && legalPage === null) return next();
        try {
          const [{ isLocale, matchLocale }, { renderPages }] = await Promise.all([
            server.ssrLoadModule('/src/lib/locale.ts'),
            server.ssrLoadModule('/src/public/render.tsx'),
          ]) as [typeof import('./src/lib/locale'), typeof import('./src/public/render')];
          const cookies = req.headers.cookie ?? '';
          let signedIn = false;
          let profileLocale: string | undefined;
          if (/(?:^|;\s*)(?:__Secure-)?dsh-teamwork-session=/.test(cookies)) {
            const response = await fetch('http://localhost:3801/api/profile', { headers: { cookie: cookies } });
            if (response.ok) {
              signedIn = true;
              const profile = await response.json() as { locale?: unknown };
              if (isLocale(profile.locale)) profileLocale = profile.locale;
            }
          }
          const choice = /(?:^|;\s*)locale=([^;]+)/.exec(cookies)?.[1];
          const locale = profileLocale ?? (choice && isLocale(choice) ? choice : matchLocale(req.headers['accept-language']));
          const legalDir = process.env.LEGAL_DIR?.trim();
          const legalRoot = legalDir ? resolve(isAbsolute(legalDir) ? legalDir : join(fileURLToPath(new URL('../..', import.meta.url)), legalDir)) : null;
          const legal = legalRoot ? {
            privacy: readFileSync(join(legalRoot, 'privacy.md'), 'utf8'),
            terms: readFileSync(join(legalRoot, 'terms.md'), 'utf8'),
          } : null;
          const pages = renderPages({ css: ['/src/globals.css'], script: '/src/public/client.ts' }, legal);
          const name = home ? `home.${locale}${signedIn ? '.signed-in' : ''}.html` : doc !== null ? `docs.${doc}.${locale}.html` : `${legalPage}.html`;
          const html = pages[name];
          res.statusCode = html ? 200 : 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Vary', 'Cookie, Authorization, Accept-Language');
          res.end(html && req.method !== 'HEAD' ? html.replaceAll('%APP_URL%', process.env.APP_URL || 'http://localhost:3800') : undefined);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), publicPages()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:3801' } },
  build: {
    manifest: true,
    rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), public: fileURLToPath(new URL('./src/public/client.ts', import.meta.url)) } },
  },
});
