import { createTranslator } from 'use-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { Locale } from '@/lib/locale';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

import { LocaleMenu, ThemeButton } from './controls';
import { SITE_ORIGIN } from './site';
import { Topology } from './topology';
import { Sea } from './sea';

/*
 * The home page every instance has: what DSH Teamwork is, as an open-source
 * project and as a service, and the one way in: the title, one sentence and
 * the plugin to copy on the left (the header carries *Create a team*), how a
 * team uses it as one diagram on the right (./topology.tsx), and the
 * product's real screens in the sections below (docs/design.md, "The landing page's first screen"). The story is the brand's
 * (docs/design.md, "The mark"): one person's work surfaces, and what the team
 * does settles underneath as its own assets. So the page goes down: from the
 * surface where people work (every platform), through collaboration and
 * governance, to the team's assets on the deep floor, then the closing call on
 * the one navy band. Each section is labelled with its depth. A capability
 * that is planned, or offered only by the hosted service, says so where it
 * appears (ADR 0007: a claim here holds for any instance). A deployment's
 * legal pages are linked when it has them.
 *
 * Prerendered when the console is built (scripts/prerender.mjs), once per
 * locale and sign-in state; the Go server picks one per request
 * (server/internal/web). It runs no React in the browser: the language picker
 * and theme controls come from ./controls.tsx and src/public/client.ts wires
 * them, and the narrow screen's menu is a <details>.
 */

const code = (chunks: ReactNode) => <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.9em]">{chunks}</code>;

function Depth({ depth, label }: { depth: string; label: string }) {
  return (
    <p className="mb-6 flex items-center gap-3 font-mono text-xs font-semibold tracking-wider text-foreground">
      {depth}
      <span className="text-muted-foreground">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-border" />
    </p>
  );
}

function Zone({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 border-t first:border-t-0">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:py-28">{children}</div>
    </section>
  );
}

// auto-phrase keeps a CJK title from breaking inside a word where the browser supports it.
const zoneTitle = 'max-w-3xl text-balance [word-break:auto-phrase] text-3xl font-black tracking-tight sm:text-5xl sm:leading-tight';
const zoneLede = 'mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg';
/** A block of equal cells divided by hairlines: the page's one framed pattern. */
const cells = 'mt-12 grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border';

// The community edition: the open half of this product (ADR 0005), self-hosted.
const communityRepo = 'https://github.com/dsh-teamwork/dsh-teamwork-platform';

/** The three ways into a team, each with who it is for (docs/design.md, "The landing page's first screen"). */
const ENTRIES = [
  { key: 'desktop', tone: 'member' },
  { key: 'console', tone: 'admin' },
  { key: 'phone', tone: 'hosted' },
] as const;

/** The deep floor's layers, newest on top: an example of what a team keeps, drawn darker as it settles. */
const STRATA = [
  { name: 'pr-review', version: 'v12', kind: 'preset', shade: 'bg-foreground/[0.03]' },
  { name: '@acme/dsh-lint', version: '2.3.1', kind: 'plugin', shade: 'bg-foreground/[0.06]' },
  { name: 'incident-triage', version: 'v4', kind: 'preset', shade: 'bg-foreground/[0.09]' },
  { name: 'release-notes', version: 'v7', kind: 'preset', shade: 'bg-foreground/[0.12]' },
  { name: 'acme-infra assistant', version: 'v1', kind: 'preset', shade: 'bg-foreground/[0.15]' },
] as const;

/** A capability that is not here yet, said where it appears (ADR 0007). */
function Coming({ label }: { label: string }) {
  return <span className="rounded-full border border-dashed border-input px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">{label}</span>;
}

/** The plugin's npm name: what DSH installs to join a team (the plugin's own README, "Install"). */
const PLUGIN = '@dsh-teamwork/dsh-teamwork';

/** The package to copy, with its button (wired by client.ts, since this page runs no React). */
function Copyable({ text, prefix, label }: { text: string; prefix: string; label: string }) {
  return (
    <span className="flex h-12 min-w-0 max-w-full items-center gap-2 rounded-lg border bg-muted pr-1.5 pl-3 font-mono text-[13px] sm:gap-3 sm:pl-4 sm:text-sm">
      <span className="shrink-0 font-sans text-xs text-muted-foreground">{prefix}</span>
      <code className="min-w-0 overflow-x-auto whitespace-nowrap">{text}</code>
      <button type="button" data-copy={text} className="h-9 min-w-14 shrink-0 rounded-md bg-primary px-3 font-sans text-sm font-medium text-primary-foreground hover:bg-primary/90">
        {label}
      </button>
    </span>
  );
}

/** A real screen of the product, in a plain window frame drawn from tokens (docs/design.md, "The landing page's first screen"). */
function Shot({ src, alt, width, height, bar }: { src: string; alt: string; width: number; height: number; bar?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xl">
      <div aria-hidden="true" className="flex h-6 items-center gap-1.5 border-b bg-muted px-3">
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        {bar && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{bar}</span>}
      </div>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" className="block w-full" />
    </div>
  );
}

/** The phone app's screen, in a phone frame cut off at the bottom of its panel. */
function PhoneShot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="grid place-items-center overflow-hidden rounded-xl border bg-muted pt-8">
      <div className="w-[min(46%,16rem)] overflow-hidden rounded-t-[2rem] border-[7px] border-b-0 border-foreground bg-card">
        <img src={src} alt={alt} width={560} height={953} loading="lazy" className="block w-full" />
      </div>
    </div>
  );
}

/** One way into the team, with what it is for on one side and its real screen on the other. */
function Entry({ who, whoTone, title, items, flip, children }: {
  who: string; whoTone: 'member' | 'admin' | 'hosted'; title: string; items: { title: string; body: string }[]; flip?: boolean; children: ReactNode;
}) {
  const tone = whoTone === 'admin' ? 'border-brand bg-brand text-brand-foreground' : whoTone === 'hosted' ? 'border-dashed border-input' : 'border-border';
  return (
    <div className={`grid items-center gap-10 lg:gap-14 ${flip ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]' : 'lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'}`}>
      <div className={flip ? 'lg:order-2' : undefined}>
        <p className="flex items-center gap-2 font-mono text-xs font-semibold tracking-wider text-muted-foreground">
          <span className={`rounded-full border px-2 py-0.5 ${tone}`}>{who}</span>
          {title}
        </p>
        <ul className="mt-5 flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.title}>
              <h3 className="text-base font-bold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
      {children}
    </div>
  );
}

export interface HomeProps {
  locale: Locale;
  signedIn: boolean;
  /** Whether this build published the legal pages (LEGAL_DIR was set). */
  legal: boolean;
}

export function HomePage({ locale, signedIn, legal }: HomeProps) {
  const messages = locale === 'zh-CN' ? zhCN : en;
  const t = createTranslator({ locale, messages, namespace: 'home' });
  const tc = createTranslator({ locale, messages, namespace: 'common' });
  const tag = locale === 'zh-CN' ? 'zh' : 'en';

  const origin = SITE_ORIGIN;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${origin}/#org`, name: tc('appName'), url: origin, logo: `${origin}/icon.png` },
      { '@type': 'WebSite', '@id': `${origin}/#site`, name: tc('appName'), url: origin, description: t('tagline'), publisher: { '@id': `${origin}/#org` } },
    ],
  };

  // Signed out, the way in is creating a team: sign-in returns to /teams, where that happens.
  const start = signedIn ? { href: '/teams', label: t('openConsole') } : { href: '/sign-in?next=%2Fteams', label: t('createTeam') };
  // The page's sections, then the documentation.
  const nav = [
    ['#everywhere', 'nav.everywhere'],
    ['#collaborate', 'nav.collaborate'],
    ['#govern', 'nav.govern'],
    ['#assets', 'nav.assets'],
    ['#self-host', 'nav.selfhost'],
    ['/docs', 'nav.docs'],
  ] as const;
  const faqs = [1, 2, 3, 4, 5, 6] as const;

  return (
    <>
      <script
        type="application/ld+json"
        // `<` escaped so nothing in a name can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <header className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <a href="/" className="flex shrink-0 items-center gap-2.5 text-lg font-bold tracking-tight">
          <img src="/logo.svg" alt="" width={30} height={30} />
          {tc('appName')}
        </a>
        <nav aria-label={t('nav.label')} className="hidden gap-6 text-sm text-muted-foreground lg:flex">
          {nav.map(([href, key]) => (
            <a key={href} href={href} className="hover:text-foreground">
              {t(key)}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleMenu locale={locale} label={tc('language')} names={(l) => tc(`localeNames.${l}`)} placement="header" />
          <ThemeButton label={tc('theme.toggle')} />
          <Button asChild className="hidden sm:inline-flex">
            <a href={start.href}>{start.label}</a>
          </Button>
          {/* Narrow screens: the sections behind a native disclosure, since this page runs no React. */}
          <details data-menu="" className="group relative lg:hidden">
            <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md border border-input [&::-webkit-details-marker]:hidden" aria-label={t('nav.menu')}>
              <span aria-hidden="true" className="flex w-4 flex-col gap-1">
                <span className="h-px bg-foreground" />
                <span className="h-px bg-foreground" />
                <span className="h-px bg-foreground" />
              </span>
            </summary>
            <div className="absolute right-0 z-10 mt-2 flex w-56 flex-col rounded-lg border bg-background p-1 shadow-lg">
              {nav.map(([href, key]) => (
                <a key={href} href={href} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                  {t(key)}
                </a>
              ))}
              <a href={start.href} className="mt-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground sm:hidden">
                {start.label}
              </a>
            </div>
          </details>
        </div>
      </header>

      <main>
        {/* The first screen: the hero centred above the sea, whose line sits at the screen's foot. */}
        <div className="flex flex-col lg:min-h-[calc(100svh-4rem)]">
          <section className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] gap-12 px-6 pt-12 sm:pt-14 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:content-center lg:items-center lg:gap-14 lg:pt-6">
            <div className="flex flex-col gap-6">
              {/* Mono capitals suit the English label; a Chinese one is set in the page's own face. */}
              <p className={`text-xs font-semibold text-muted-foreground ${locale === 'en' ? 'font-mono uppercase tracking-widest' : 'tracking-wider'}`}>{t('eyebrow')}</p>
              <h1 className="text-balance [word-break:auto-phrase] text-4xl font-black tracking-tight sm:text-5xl sm:leading-[1.08]">{t('title')}</h1>
              {/* A language whose sentence needs a chosen break writes it in the message (\n). */}
              <p className="whitespace-pre-line text-lg text-muted-foreground">{t('lede')}</p>
              <div className="mt-2 flex flex-col items-start gap-2.5">
                <Copyable text={PLUGIN} prefix={t('install.plugin')} label={t('install.copy')} />
                <p className="text-sm text-muted-foreground">
                  {t('install.hint')}{' '}
                  <a href="/docs/install" className="font-medium text-foreground underline-offset-4 hover:underline">
                    {t('install.more')} →
                  </a>
                </p>
              </div>
            </div>
            <Topology locale={locale} />
          </section>

          <Sea />
        </div>

        <div>
          <Zone id="shift">
            <Depth depth={t('shift.depth')} label={t('shift.label')} />
            <h2 className={zoneTitle}>{t('shift.title')}</h2>
            <p className={zoneLede}>{t('shift.lede')}</p>
            <div className="mt-12 max-w-4xl">
              <div className="grid grid-cols-2 gap-6 pb-3 font-mono text-xs font-semibold tracking-wider text-muted-foreground">
                <span>{t('shift.alone')}</span>
                <span className="text-brand">{t('shift.together')}</span>
              </div>
              <ul>
                {([1, 2, 3, 4] as const).map((n) => (
                  <li key={n} className="grid grid-cols-2 gap-6 border-t border-border py-5 last:border-b">
                    <p className="text-sm text-muted-foreground sm:text-base">{t(`shift.from${n}`)}</p>
                    <p className="text-sm font-semibold sm:text-base">{t(`shift.to${n}`)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Zone>

          <Zone id="everywhere">
            <Depth depth={t('everywhere.depth')} label={t('everywhere.label')} />
            <h2 className={zoneTitle}>{t('everywhere.title')}</h2>
            <p className={zoneLede}>{t('everywhere.lede')}</p>
            <div className="mt-14 flex flex-col gap-20">
              {ENTRIES.map(({ key, tone }, i) => (
                <Entry
                  key={key}
                  who={t(`everywhere.${key}.who`)}
                  whoTone={tone}
                  title={t(`everywhere.${key}.title`)}
                  items={([1, 2, 3] as const).map((n) => ({ title: t(`everywhere.${key}.item${n}Title`), body: t(`everywhere.${key}.item${n}Body`) }))}
                  flip={i % 2 === 1}
                >
                  {key === 'phone' ? (
                    <PhoneShot src={`/home/phone-${tag}.webp`} alt={t('everywhere.phone.alt')} />
                  ) : key === 'console' ? (
                    <Shot src={`/home/console-${tag}.webp`} alt={t('everywhere.console.alt')} width={1400} height={766} bar={tc('appName')} />
                  ) : (
                    <Shot src={`/home/desktop-${tag}.webp`} alt={t('everywhere.desktop.alt')} width={1400} height={875} bar="DSH · Teamwork" />
                  )}
                </Entry>
              ))}
            </div>
          </Zone>

          <Zone id="collaborate">
            <Depth depth={t('collaborate.depth')} label={t('collaborate.label')} />
            <h2 className={zoneTitle}>{t('collaborate.title')}</h2>
            <p className={zoneLede}>{t('collaborate.lede')}</p>
            <div className="mt-12 grid items-center gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <ul className="flex flex-col">
                {(['presets', 'plugins', 'assistant', 'review'] as const).map((item) => (
                  <li key={item} className="flex flex-col gap-1 border-t border-border py-5 last:border-b">
                    <h3 className="text-base font-bold">{t(`collaborate.${item}Title`)}</h3>
                    <p className="text-sm text-muted-foreground">{t.rich(`collaborate.${item}Body`, { code })}</p>
                  </li>
                ))}
              </ul>
              <Shot src={`/home/review-${tag}.webp`} alt={t('collaborate.alt')} width={1100} height={550} />
            </div>
          </Zone>

          <Zone id="govern">
            <Depth depth={t('govern.depth')} label={t('govern.label')} />
            <h2 className={zoneTitle}>{t('govern.title')}</h2>
            <p className={zoneLede}>{t('govern.lede')}</p>
            <div className="mt-12 grid items-center gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <Shot src={`/home/usage-${tag}.webp`} alt={t('govern.alt')} width={1100} height={599} />
              <ul className="flex flex-col">
                {(['budgets', 'usage', 'keys', 'members'] as const).map((item) => (
                  <li key={item} className="flex flex-col gap-1 border-t border-border py-5 last:border-b">
                    <h3 className="text-base font-bold">{t(`govern.${item}Title`)}</h3>
                    <p className="text-sm text-muted-foreground">{t(`govern.${item}Body`)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <blockquote className="mt-12 border-t border-border pt-8">
              <p className="max-w-3xl text-balance text-xl font-bold sm:text-2xl">“{t('govern.promise')}”</p>
              <p className="mt-3 font-mono text-xs text-muted-foreground">{t('govern.promiseNote')}</p>
            </blockquote>
          </Zone>

          <Zone id="assets">
            <Depth depth={t('assets.depth')} label={t('assets.label')} />
            <h2 className={zoneTitle}>{t('assets.title')}</h2>
            <p className={zoneLede}>{t('assets.lede')}</p>
            <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <figure className="min-w-0">
                {/* Layers settling: newest on top, each a shade darker as it goes down. */}
                <ol className="overflow-hidden rounded-xl ring-1 ring-border">
                  {STRATA.map((layer) => (
                    <li key={layer.name} className={`flex items-baseline gap-3 border-t border-border px-5 py-3.5 font-mono text-[13px] first:border-t-0 ${layer.shade}`}>
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{layer.kind}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{layer.name}</span>
                      <span className="shrink-0 text-muted-foreground">{layer.version}</span>
                    </li>
                  ))}
                </ol>
                <figcaption className="mt-3 text-sm text-muted-foreground">{t('assets.caption')}</figcaption>
              </figure>
              <ul className="flex flex-col">
                {(['versions', 'restore', 'export'] as const).map((item) => (
                  <li key={item} className="flex flex-col gap-1 border-t border-border py-5">
                    <h3 className="text-base font-bold">{t(`assets.${item}Title`)}</h3>
                    <p className="text-sm text-muted-foreground">{t(`assets.${item}Body`)}</p>
                  </li>
                ))}
                <li className="flex flex-col gap-1 border-y border-dashed border-border py-5">
                  <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
                    {t('assets.nextTitle')}
                    <Coming label={t('everywhere.status.coming')} />
                  </h3>
                  <p className="text-sm text-muted-foreground">{t('assets.nextBody')}</p>
                </li>
              </ul>
            </div>
          </Zone>

          <Zone id="self-host">
            <Depth depth={t('community.depth')} label={t('community.label')} />
            <h2 className={zoneTitle}>{t('community.title')}</h2>
            <p className={zoneLede}>{t('community.lede')}</p>
            <div className={`${cells} md:grid-cols-2`}>
              <div className="flex flex-col gap-3 bg-background p-6">
                <h3 className="text-base font-bold">{t('community.hostedTitle')}</h3>
                <p className="flex-1 text-sm text-muted-foreground">{t('community.hostedBody')}</p>
              </div>
              <div className="flex flex-col gap-3 bg-background p-6">
                <h3 className="text-base font-bold">{t('community.openTitle')}</h3>
                <p className="flex-1 text-sm text-muted-foreground">{t('community.openBody')}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Button asChild>
                    <a href={communityRepo}>{t('community.repo')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href="/docs/self-hosting">{t('community.guide')}</a>
                  </Button>
                </div>
              </div>
            </div>
          </Zone>

          <Zone id="faq">
            <Depth depth={t('faq.depth')} label={t('faq.label')} />
            <h2 className={zoneTitle}>{t('faq.title')}</h2>
            <div className="mt-10 max-w-3xl">
              {faqs.map((n) => (
                <details key={n} open={n === 1} className="group border-t border-border py-5 last:border-b">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
                    {t(`faq.q${n}`)}
                    <span aria-hidden="true" className="font-mono text-xl font-normal text-muted-foreground group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-muted-foreground">{t(`faq.a${n}`)}</p>
                </details>
              ))}
            </div>
          </Zone>

          <section className="bg-brand text-brand-foreground">
            <div className="mx-auto max-w-7xl px-6 py-20 sm:py-28">
              <p className="mb-6 flex items-center gap-3 font-mono text-xs font-semibold tracking-wider">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
                {t('final.depth')}
                <span className="opacity-75">{t('final.label')}</span>
              </p>
              <h2 className={zoneTitle}>{t('final.title')}</h2>
              <p className="mt-5 max-w-2xl text-base opacity-80 sm:text-lg">{t('final.lede')}</p>
              <Button asChild size="lg" className="mt-8 bg-background text-foreground hover:bg-background/90">
                <a href={start.href}>{start.label}</a>
              </Button>
            </div>
          </section>

          <footer className="border-t border-border">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-8 text-sm text-muted-foreground">
              <span className="flex items-center gap-2 font-bold text-foreground">
                <img src="/logo.svg" alt="" width={22} height={22} />
                {tc('appName')}
              </span>
              <a href="/docs" className="underline-offset-4 hover:underline">
                {t('nav.docs')}
              </a>
              {legal && (
                <>
                  <a href="/privacy" className="underline-offset-4 hover:underline">
                    {tc('privacy')}
                  </a>
                  <a href="/terms" className="underline-offset-4 hover:underline">
                    {tc('terms')}
                  </a>
                </>
              )}
              <div className="ml-auto flex items-center gap-2">
                <ThemeButton label={tc('theme.toggle')} />
                <LocaleMenu locale={locale} label={tc('language')} names={(l) => tc(`localeNames.${l}`)} />
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
