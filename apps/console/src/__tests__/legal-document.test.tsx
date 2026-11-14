import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';


import { LegalDocument } from '@/public/legal-document';

// A legal document carries notes for whoever fills the template in, in HTML
// comments; a reader of the published page must never see them.
const DOCUMENT = '<!-- Note for whoever fills this in: name the processors. -->\n# Privacy Policy\n\n_Last updated: November 12, 2026_\n\nWe keep what you give us.';

describe('LegalDocument', () => {
  it('renders a document without the notes in its comments', () => {
    const html = renderToStaticMarkup(<LegalDocument markdown={DOCUMENT} />);
    expect(html).toContain('Last updated:');
    expect(html).not.toContain('Note for whoever');
    expect(html).not.toContain('&lt;!--');
  });

  it('links a sibling legal document to its page and drops any other relative link', () => {
    const html = renderToStaticMarkup(
      <LegalDocument markdown={'[Privacy](privacy.md), [ADR](../adr/0001-x.md), [Site](https://example.com)'} />,
    );
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('adr/0001-x.md');
    expect(html).toContain('<span>ADR</span>');
    expect(html).toContain('href="https://example.com"');
  });
});
