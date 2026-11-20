/**
 * The public pages as static HTML: home in each locale and sign-in state, the
 * documentation (`/docs`) in each locale, and the legal pages where the build
 * has them. scripts/prerender.mjs builds this
 * file for Node and calls `renderPages`; the Go server embeds what it writes
 * and picks a page per request (server/internal/web).
 *
 * These are the pages a crawler indexes, so none carries `noindex`, and each
 * names itself through SITE_ORIGIN, which the server replaces with APP_URL.
 */

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LOCALES, type Locale } from '@/lib/locale';
import { THEME_SCRIPT } from '@/lib/theme';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

import { DOC_PAGES, DocsPage, docPath, loadDoc } from './docs';
import { HomePage, type HomeWorkspace } from './home';
import { LegalDocument } from './legal-document';
import { SITE_ORIGIN } from './site';

export interface Assets {
  /** The console's stylesheet, so the pages look like the console. */
  css: string[];
  /** The public pages' one script (src/public/client.ts): analytics and the language picker. */
  script: string;
}

export interface LegalSources {
  privacy: string;
  terms: string;
}

const APP_NAME = en.common.appName;


interface DocumentProps {
  locale: Locale;
  title: string;
  description: string;
  path: string;
  assets: Assets;
  children: ReactNode;
}

function Document({ locale, title, description, path, assets, children }: DocumentProps) {
  const url = `${SITE_ORIGIN}${path}`;
  const image = `${SITE_ORIGIN}/opengraph-image.png`;
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <link rel="icon" href="/icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={APP_NAME} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={image} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={APP_NAME} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={image} />
        {/* The theme before the first paint, as the console's index.html does it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <script type="module" src={assets.script} />
      </head>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}

const page = (element: ReactNode) => `<!doctype html>${renderToStaticMarkup(element)}`;

/** Every public page, by the file name the Go server looks it up by. */
export function renderPages(
  assets: Assets,
  legal: LegalSources | null,
  homeWorkspace?: (locale: Locale) => HomeWorkspace,
): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const locale of LOCALES) {
    const workspace = homeWorkspace?.(locale);
    const tagline = (locale === 'zh-CN' ? zhCN : en).home.tagline;
    for (const signedIn of [false, true]) {
      pages[`home.${locale}${signedIn ? '.signed-in' : ''}.html`] = page(
        <Document locale={locale} title={APP_NAME} description={tagline} path="/" assets={assets}>
          <HomePage locale={locale} signedIn={signedIn} legal={legal !== null} workspace={workspace} />
        </Document>,
      );
    }
  }
  // `/docs/install` in Chinese is docs.install.zh-CN.html; `/docs` itself is the `index` page.
  for (const { locale, slug } of DOC_PAGES) {
    const doc = loadDoc(locale, slug);
    const docs = (locale === 'zh-CN' ? zhCN : en).docs.title;
    pages[`docs.${slug}.${locale}.html`] = page(
      <Document locale={locale} title={`${doc.title} · ${APP_NAME} ${docs}`} description={doc.description} path={docPath(slug)} assets={assets}>
        <DocsPage locale={locale} slug={slug} />
      </Document>,
    );
  }
  if (legal) {
    pages['privacy.html'] = legalPage(assets, 'privacy', 'Privacy Policy', 'What we collect, where it is kept, who can see it, and how to have it removed.', legal.privacy);
    pages['terms.html'] = legalPage(assets, 'terms', 'Terms of Service', 'The terms that govern using this service.', legal.terms);
  }
  return pages;
}

/**
 * One legal page at `/{name}`, English as its Markdown is, filed as
 * `{name}.html`. An edition that publishes a legal page of its own adds it
 * to what its renderPages returns through this.
 */
export function legalPage(assets: Assets, name: string, title: string, description: string, markdown: string): string {
  return page(
    <Document locale="en" title={`${title} · ${APP_NAME}`} description={description} path={`/${name}`} assets={assets}>
      <LegalDocument markdown={markdown} />
    </Document>,
  );
}
