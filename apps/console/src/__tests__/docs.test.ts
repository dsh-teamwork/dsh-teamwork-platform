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
});
