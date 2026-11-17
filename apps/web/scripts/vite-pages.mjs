// The public pages in development: what scripts/prerender.mjs writes at build,
// rendered from source by the web Vite server instead. The Go server asks for
// them (server/internal/web, DEV_VITE) and decides, as it does over a build,
// which page answers a path: GET /__pages lists the file names, and
// GET /__pages/{name} is one page. A web app's own src/public/render.tsx is
// the renderer, src/globals.css its stylesheet and src/public/client.ts its
// script, as at build. Rendered pages are kept until a source file changes.
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** LEGAL_DIR's privacy.md and terms.md, as prerender.mjs reads them; null without it. */
export function legalSources() {
  const dir = process.env.LEGAL_DIR?.trim();
  if (!dir) return null;
  const file = (name) => readFileSync(resolve(isAbsolute(dir) ? dir : join(repo, dir), `${name}.md`), 'utf8');
  return { privacy: file('privacy'), terms: file('terms') };
}

/** @returns {import('vite').Plugin} */
export function publicPages() {
  return {
    name: 'public-pages',
    configureServer(server) {
      let pages = null;
      server.watcher.on('all', () => { pages = null; });
      server.middlewares.use('/__pages', async (req, res, next) => {
        try {
          if (!pages) {
            const { renderPages } = await server.ssrLoadModule('/src/public/render.tsx');
            pages = renderPages({ css: ['/src/globals.css'], script: '/src/public/client.ts' }, legalSources());
          }
          const name = decodeURIComponent((req.url ?? '/').slice(1));
          const body = name === '' ? JSON.stringify(Object.keys(pages)) : pages[name];
          res.statusCode = body === undefined ? 404 : 200;
          res.setHeader('Content-Type', name === '' ? 'application/json' : 'text/html; charset=utf-8');
          res.end(body);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
