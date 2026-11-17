import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

import { DOC_PAGES, SLUGS, anchor, loadDoc, parseDoc } from '@/public/docs';

describe('the published documentation', () => {
  it('has every page in every language, each with a title and a description', () => {
    for (const { locale, slug } of DOC_PAGES) {
      const doc = loadDoc(locale, slug);
      expect(doc.title, `${locale}/${slug}`).not.toBe('');
      expect(doc.description, `${locale}/${slug}`).not.toBe('');
      expect(doc.body.trim(), `${locale}/${slug}`).not.toBe('');
    }
  });

  it('links only to pages that exist', () => {
    const paths = new Set(SLUGS.map((s) => (s === 'index' ? '/docs' : `/docs/${s}`)));
    for (const { locale, slug } of DOC_PAGES) {
      for (const [, href] of loadDoc(locale, slug).body.matchAll(/\]\((\/docs[^)#\s]*)/g)) {
        expect(paths.has(href), `${locale}/${slug} links to ${href}`).toBe(true);
      }
    }
  });

  it('reads front matter and keeps the body after it', () => {
    expect(parseDoc('---\ntitle: A: B\ndescription: C\n---\n\nBody')).toEqual({ title: 'A: B', description: 'C', body: '\nBody' });
  });

  it('anchors headings in any script', () => {
    expect(anchor('Sign in')).toBe('sign-in');
    expect(anchor('Café Größe')).toBe('café-größe');
  });

  // The Go server routes; Vite only renders the page it names (scripts/vite-pages.mjs).
  it('renders public pages by name in development, as the build writes them', async () => {
    const server = await createServer({
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP address');
      const origin = `http://127.0.0.1:${address.port}`;
      const names = (await (await fetch(`${origin}/__pages`)).json()) as string[];
      expect(names).toEqual(expect.arrayContaining(['home.en.html', 'home.zh-CN.signed-in.html', 'docs.index.en.html', 'docs.install.zh-CN.html']));
      const home = await fetch(`${origin}/__pages/home.en.html`);
      expect(home.status).toBe(200);
      const html = await home.text();
      expect(html).toContain('/src/public/client.ts');
      expect(html).toContain('%APP_URL%');
      expect(html).not.toContain('/src/main.tsx');
      expect((await fetch(`${origin}/__pages/pricing.en.html`)).status).toBe(404);
    } finally {
      await server.close();
    }
  }, 20_000);
});
