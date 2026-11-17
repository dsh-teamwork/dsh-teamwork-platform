/**
 * The product's published documentation at `/docs`, written for its users:
 * installing the plugin, setting up a team, working in one, and running a
 * server. Each page is a Markdown file in `content/docs/{locale}/{slug}.md`
 * with a `title` and `description` in its front matter; `SECTIONS` is the
 * sidebar's order. Prerendered with the other public pages (render.tsx), one
 * file per page and locale; the Go server picks the viewer's language, as it
 * does for the home page (server/internal/web).
 *
 * Like the home page it runs no React in the browser: the narrow screen's
 * page list is a <details>, and the code blocks' copy buttons are wired by
 * src/public/client.ts. This is product content, not part of `docs/`, so it
 * follows neither that tree's header nor its index rule.
 */

import type { ComponentProps, ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createTranslator } from 'use-intl';

import { LOCALES, type Locale } from '@/lib/locale';
import { cn } from '@/lib/utils';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

import { LocaleMenu, ThemeButton } from './controls';

/** The sidebar: each section's pages, by slug. `index` is `/docs` itself. */
export const SECTIONS = [
  { key: 'start', pages: ['index', 'install'] },
  { key: 'teams', pages: ['admins', 'members', 'commands'] },
  { key: 'run', pages: ['self-hosting'] },
] as const;

export type Slug = (typeof SECTIONS)[number]['pages'][number];
export const SLUGS: Slug[] = SECTIONS.flatMap((s) => [...s.pages]);

export const docPath = (slug: Slug) => (slug === 'index' ? '/docs' : `/docs/${slug}`);

const SOURCES = import.meta.glob<string>('../../content/docs/*/*.md', { query: '?raw', import: 'default', eager: true });

export interface Doc {
  title: string;
  description: string;
  body: string;
}

/** A page's front matter (`title`, `description`) and the Markdown after it. */
export function parseDoc(source: string): Doc {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { title: fields.title ?? '', description: fields.description ?? '', body: match ? source.slice(match[0].length) : source };
}

/** One page in one language; a page missing in that language is a build error, not a blank page. */
export function loadDoc(locale: Locale, slug: Slug): Doc {
  const source = SOURCES[`../../content/docs/${locale}/${slug}.md`];
  if (source === undefined) throw new Error(`content/docs/${locale}/${slug}.md is missing`);
  return parseDoc(source);
}

/** A heading's anchor: its words, lower-cased and joined by hyphens, in any script. */
export function anchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : node && typeof node === 'object' && 'props' in node
        ? textOf((node.props as { children?: ReactNode }).children)
        : '';

/** The page's `##` headings, for "On this page". */
const headings = (body: string) =>
  [...body.matchAll(/^## (.+)$/gm)].map((m) => {
    const text = m[1].replace(/[`*_]/g, '');
    return { text, id: anchor(text) };
  });

function Heading({ level, children }: { level: 2 | 3; children?: ReactNode }) {
  const id = anchor(textOf(children));
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag id={id} className="scroll-mt-20">
      {children}
    </Tag>
  );
}

/** A code block with a copy button; client.ts copies its `data-copy`. */
function CodeBlock({ children, label }: { children?: ReactNode; label: string }) {
  const text = textOf(children).replace(/\n$/, '');
  return (
    <div className="relative">
      <pre>{children}</pre>
      <button type="button" data-copy={text} className="absolute top-2 right-2 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        {label}
      </button>
    </div>
  );
}

/** Links out open as they are; a link within the site stays in this tab. */
function DocLink({ href, children, ...rest }: ComponentProps<'a'>) {
  const external = href ? /^https?:/.test(href) : false;
  return (
    <a href={href} {...(external ? { rel: 'noreferrer' } : {})} {...rest}>
      {children}
    </a>
  );
}

export function DocsPage({ locale, slug }: { locale: Locale; slug: Slug }) {
  const messages = locale === 'zh-CN' ? zhCN : en;
  const t = createTranslator({ locale, messages, namespace: 'docs' });
  const tc = createTranslator({ locale, messages, namespace: 'common' });
  const doc = loadDoc(locale, slug);
  const toc = headings(doc.body);
  const at = SLUGS.indexOf(slug);
  const previous = at > 0 ? SLUGS[at - 1] : undefined;
  const next = at < SLUGS.length - 1 ? SLUGS[at + 1] : undefined;
  const titleOf = (s: Slug) => loadDoc(locale, s).title;

  const nav = (
    <nav aria-label={t('label')} className="flex flex-col gap-5">
      {SECTIONS.map((section) => (
        <div key={section.key} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t(`sections.${section.key}`)}</p>
          {section.pages.map((page) => (
            <a
              key={page}
              href={docPath(page)}
              aria-current={page === slug ? 'page' : undefined}
              className={cn(
                'relative rounded-md px-2.5 py-1.5 text-sm hover:bg-accent',
                // The current page: a grey fill and the navy bar, as in the console's sidebar (docs/design.md).
                page === slug && 'bg-secondary font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand',
              )}
            >
              {titleOf(page)}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <a href="/" className="flex shrink-0 items-center gap-2.5 font-bold tracking-tight">
            <img src="/logo.svg" alt="" width={26} height={26} />
            {tc('appName')}
          </a>
          <a href="/docs" className="text-sm text-muted-foreground hover:text-foreground">
            {t('title')}
          </a>
          <ThemeButton label={tc('theme.toggle')} className="ml-auto" />
          <a href="/teams" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            {t('console')}
          </a>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-[13rem_minmax(0,1fr)_11rem] md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden py-10 md:block">
          <div className="sticky top-24">{nav}</div>
        </aside>

        <main className="min-w-0 py-8 md:py-10">
          {/* Narrow screens: the page list behind a native disclosure. */}
          <details data-menu="" className="mb-6 rounded-lg border md:hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">{t('menu')}</summary>
            <div className="border-t px-2 py-3">{nav}</div>
          </details>

          <article lang={locale} className="prose-document">
            <h1>{doc.title}</h1>
            <p className="text-lg">{doc.description}</p>
            <Markdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                h2: ({ children }) => <Heading level={2}>{children}</Heading>,
                h3: ({ children }) => <Heading level={3}>{children}</Heading>,
                pre: ({ children }) => <CodeBlock label={t('copy')}>{children}</CodeBlock>,
                a: DocLink,
              }}
            >
              {doc.body}
            </Markdown>
          </article>

          <nav aria-label={t('pager')} className="mt-14 grid gap-3 border-t pt-6 sm:grid-cols-2">
            {previous && (
              <a href={docPath(previous)} className="flex flex-col gap-0.5 rounded-lg border p-4 hover:bg-accent">
                <span className="text-xs text-muted-foreground">{t('previous')}</span>
                <span className="font-medium">{titleOf(previous)}</span>
              </a>
            )}
            {next && (
              <a href={docPath(next)} className="flex flex-col gap-0.5 rounded-lg border p-4 text-right hover:bg-accent sm:col-start-2">
                <span className="text-xs text-muted-foreground">{t('next')}</span>
                <span className="font-medium">{titleOf(next)}</span>
              </a>
            )}
          </nav>
        </main>

        {toc.length > 0 && (
          <aside className="hidden py-10 lg:block">
            <div className="sticky top-24 flex flex-col gap-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{t('onThisPage')}</p>
              {toc.map((h) => (
                <a key={h.id} href={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
                  {h.text}
                </a>
              ))}
            </div>
          </aside>
        )}
      </div>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-6 text-sm text-muted-foreground">
          <a href="/" className="hover:text-foreground">
            {t('home')}
          </a>
          <a href="https://github.com/dsh-teamwork/dsh-teamwork/issues" className="hover:text-foreground">
            {t('issues')}
          </a>
          <div className="ml-auto flex items-center gap-2">
            <ThemeButton label={tc('theme.toggle')} />
            <LocaleMenu locale={locale} label={tc('language')} names={(l) => tc(`localeNames.${l}`)} />
          </div>
        </div>
      </footer>
    </>
  );
}

/** Every page in every language, for the prerender and its test. */
export const DOC_PAGES = LOCALES.flatMap((locale) => SLUGS.map((slug) => ({ locale, slug })));
