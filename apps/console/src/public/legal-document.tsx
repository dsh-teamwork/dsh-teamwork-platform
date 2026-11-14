// A deployment's legal document, rendered — `privacy.md`, `terms.md` from
// LEGAL_DIR, read when the console is built (scripts/prerender.mjs). Adapted
// from myaidesk apps/web/components/legal-document.tsx.
//
// Legal pages are English whatever the interface language: a translation is a
// second text somebody could hold us to, and none has been reviewed. `lang`
// on the article says so to the browser and to screen readers.

import type { ComponentProps } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** The documents beside this one that are also pages, by their file name. */
const PAGES: Record<string, string> = { 'privacy.md': '/privacy', 'terms.md': '/terms' };

/**
 * A link out of the document. The source is a file among other files, so a
 * relative link names a file: one that is also a page becomes a link to that
 * page, and any other keeps its words and loses its href — a dead link on a
 * legal page costs trust rather than a click. Absolute links are left alone.
 */
function DocumentLink({ href, children, ...rest }: ComponentProps<'a'>) {
  if (href && /^(https?:|mailto:)/.test(href)) {
    return (
      <a href={href} rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  const page = href ? PAGES[href] : undefined;
  if (page) return <a href={page}>{children}</a>;
  return <span>{children}</span>;
}

export function LegalDocument({ markdown }: { markdown: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <article lang="en" className="prose-document">
        {/*
          `skipHtml` drops raw HTML, and with it the comments that carry the
          notes for whoever fills the template in. Without it react-markdown
          prints them as text, on the page every user reads.
        */}
        <Markdown remarkPlugins={[remarkGfm]} components={{ a: DocumentLink }} skipHtml>
          {markdown}
        </Markdown>
      </article>
    </main>
  );
}
