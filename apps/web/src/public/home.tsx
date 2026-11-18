import { createTranslator } from 'use-intl';
import { BatteryFull, Check, Github, Signal, Users, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { Locale } from '@/lib/locale';
import en from '@/messages/en.json';
import zhCN from '@/messages/zh-CN.json';

import { LocaleMenu, ThemeButton } from './controls';
import { SITE_ORIGIN } from './site';
import { Topology } from './topology';
import { SeaBed, SeaSurface, WhalePassage, WhalePod } from './sea';

/*
 * The home page every instance has: what DSH Teamwork is, as an open-source
 * project and as a service, and the one way in: the title, one sentence and
 * the plugin to copy above the tide (the header carries *Create a team*),
 * a diagram of the team at work below (./topology.tsx), and the
 * product's real screens in the sections below (docs/design.md, "The landing page's first screen"). The story is the brand's
 * (docs/design.md, "The mark"): one person's work surfaces, and what the team
 * does settles underneath as its own assets. So the page goes down: from the
 * surface where people work (every platform), through collaboration and
 * governance, to the team's assets and the closing call on the deep floor. Each section is labelled with its depth. A capability
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

/** The deep floor's layers, newest on top: an example of what a team keeps, drawn darker as it settles. */
const STRATA = [
  { workflow: 'marketResearch', version: 'v5', kind: 'preset', approvedAt: '2026-11-17T14:20:00Z', shade: 'bg-foreground/[0.03]' },
  { workflow: 'surveyExport', version: '1.4.0', kind: 'plugin', approvedAt: '2026-11-16T16:45:00Z', shade: 'bg-foreground/[0.06]' },
  { workflow: 'operationsBrief', version: 'v3', kind: 'preset', approvedAt: '2026-11-16T09:30:00Z', shade: 'bg-foreground/[0.09]' },
  { workflow: 'interviewNotes', version: 'v2', kind: 'preset', approvedAt: '2026-11-13T15:10:00Z', shade: 'bg-foreground/[0.12]' },
  { workflow: 'spreadsheetCleanup', version: '2.1.0', kind: 'plugin', approvedAt: '2026-11-12T11:05:00Z', shade: 'bg-foreground/[0.15]' },
] as const;

/** The plugin's npm name: what DSH installs to join a team (the plugin's own README, "Install"). */
const PLUGIN = '@dsh-teamwork/dsh-teamwork';

/** The package to copy, with its button (wired by client.ts, since this page runs no React). */
function Copyable({ text, prefix, label }: { text: string; prefix: string; label: string }) {
  return (
    <span className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-lg border bg-muted p-1.5 pl-3 font-mono text-[13px] sm:gap-x-3 sm:pl-4 sm:text-sm @min-[32rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className="shrink-0 font-sans text-xs text-muted-foreground">{prefix}</span>
      <code className="min-w-0 overflow-x-auto whitespace-nowrap @max-[32rem]:col-span-2 @max-[32rem]:row-start-2 @max-[32rem]:pb-1">{text}</code>
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
function PhoneShot({ src, alt, platformsLabel, storeSearch }: {
  src: string; alt: string; platformsLabel: string; storeSearch: ReactNode;
}) {
  return (
    <div className="flex aspect-[8/5] items-start justify-center gap-4 overflow-hidden rounded-xl border bg-muted px-3 pt-4 sm:gap-6 lg:aspect-auto lg:[contain:size]">
      <div className="w-[min(46%,10rem)] shrink-0 overflow-hidden rounded-t-[2rem] border-[5px] border-b-0 border-foreground bg-white">
        <div aria-hidden="true" className="flex h-6 items-center justify-between gap-1 px-2.5 text-black">
          <span className="text-[9px] font-semibold tabular-nums">9:41</span>
          <span className="flex items-center gap-0.5">
            <Signal className="size-2.5" />
            <Wifi className="size-2.5" />
            <BatteryFull className="h-3 w-3.5" />
          </span>
        </div>
        <img src={src} alt={alt} width={560} height={953} loading="lazy" className="block w-full" />
      </div>
      <div className="min-w-0 self-center text-xs text-muted-foreground">
        <ul aria-label={platformsLabel} className="flex flex-col gap-2 font-medium">
          {['iOS App', 'Android App'].map((platform) => (
            <li key={platform} className="flex items-center gap-1.5">
              <Check aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
              {platform}
            </li>
          ))}
        </ul>
        <p className="mt-3 leading-relaxed">{storeSearch}</p>
      </div>
    </div>
  );
}

/** Public content for workspaces offered by a different edition. */
export interface HomeWorkspace {
  browserDescription: string;
  phoneDescription: string;
  title: string;
  description: string;
  icon?: ReactNode;
}

export interface HomeProps {
  locale: Locale;
  signedIn: boolean;
  /** Whether this build published the legal pages (LEGAL_DIR was set). */
  legal: boolean;
  workspace?: HomeWorkspace;
}

export function HomePage({ locale, signedIn, legal, workspace }: HomeProps) {
  const messages = locale === 'zh-CN' ? zhCN : en;
  const t = createTranslator({ locale, messages, namespace: 'home' });
  const tc = createTranslator({ locale, messages, namespace: 'common' });
  const approvalDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'UTC',
  });
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
    ['#self-host', 'nav.pricing'],
    ['/docs', 'nav.docs'],
  ] as const;
  const faqs = ['install', 'pricing', 'selfHost', 'security'] as const;

  return (
    <>
      <script
        type="application/ld+json"
        // `<` escaped so nothing in a name can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <header className="relative z-20 mx-auto flex h-16 max-w-7xl items-center gap-1 px-3 sm:gap-4 sm:px-6 xl:gap-8">
        <a href="/" className="flex shrink-0 items-center gap-1 text-sm font-bold tracking-tight min-[22.5rem]:gap-1.5 min-[22.5rem]:text-base sm:gap-2.5 sm:text-lg">
          <img src="/logo.svg" alt="" width={30} height={30} className="max-[22.5rem]:size-7" />
          {tc('appName')}
        </a>
        <nav aria-label={t('nav.label')} className="hidden gap-6 text-sm text-muted-foreground lg:flex">
          {nav.map(([href, key]) => (
            <a key={href} href={href} className="hover:text-foreground">
              {t(key)}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center min-[22.5rem]:gap-2">
          <LocaleMenu locale={locale} label={tc('language')} names={(l) => tc(`localeNames.${l}`)} placement="header" />
          <ThemeButton label={tc('theme.toggle')} />
          <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
            <a href="https://github.com/dsh-teamwork/dsh-teamwork" aria-label={t('nav.pluginRepo')} title={t('nav.pluginRepo')}>
              <Github aria-hidden />
            </a>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <a href={start.href}>{start.label}</a>
          </Button>
          {/* Narrow screens: the sections behind a native disclosure, since this page runs no React. */}
          <details data-menu="" className="group relative lg:hidden">
            <summary className="flex size-9 list-none items-center justify-center rounded-md border border-input [&::-webkit-details-marker]:hidden" aria-label={t('nav.menu')}>
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

      <main className="tide-story" id="surface">
        <WhalePassage />
        <section className="tide-intro">
          <SeaSurface />
          <div className="tide-intro-copy mx-auto w-full max-w-7xl px-6">
            <div className="flex w-full min-w-0 max-w-xl flex-col gap-5">
              <h1 className="tide-title text-balance [word-break:auto-phrase]">{t('title')}</h1>
              <p className="tide-intro-lede text-lg font-semibold text-foreground">{t('lede')}</p>
              <div className="@container mt-2 flex flex-col items-start gap-2.5">
                <Copyable text={PLUGIN} prefix={t('install.plugin')} label={t('install.copy')} />
                <p className="text-sm text-muted-foreground">
                  {t('install.hint')}{' '}
                  <a href="/docs/install" className="font-medium text-foreground underline-offset-4 hover:underline">
                    {t('install.more')} →
                  </a>
                </p>
              </div>
            </div>
          </div>
          <a href="#shift" className="tide-link">{t('woodcut.dive')} <span aria-hidden="true">↓</span></a>
        </section>

        <Zone id="shift">
          <Depth depth={t('shift.depth')} label={t('shift.label')} />
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className={`${zoneTitle} whitespace-pre-line`}>{t('shift.title')}</h2>
              <p className={zoneLede}>{t('shift.lede')}</p>
            </div>
            <Topology locale={locale} />
          </div>
        </Zone>

        <Zone id="everywhere">
          <Depth depth={t('everywhere.depth')} label={t('everywhere.label')} />
          <h2 className={zoneTitle}>{t('everywhere.title')}</h2>
          <div className="mt-12 grid gap-x-6 gap-y-10 lg:grid-cols-3 lg:gap-y-4">
            <div className="grid min-w-0 gap-4 lg:row-span-2 lg:grid-rows-subgrid">
              <div>
                <h3 className="text-lg font-bold">{t('everywhere.desktop.title')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t('everywhere.desktop.description')}</p>
              </div>
              <Shot src={`/home/desktop-${tag}.webp`} alt={t('everywhere.desktop.alt')} width={1400} height={875} bar="DSH · Teamwork" />
            </div>
            <div className="grid min-w-0 gap-4 lg:row-span-2 lg:grid-rows-subgrid">
              <div>
                <h3 className="text-lg font-bold">{t('everywhere.console.title')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{workspace?.browserDescription ?? t('everywhere.console.description')}</p>
              </div>
              <Shot src={`/home/console-${tag}.webp`} alt={t('everywhere.console.alt')} width={1400} height={766} bar={tc('appName')} />
            </div>
            <div className="grid min-w-0 gap-4 lg:row-span-2 lg:grid-rows-subgrid">
              <div>
                <h3 className="text-lg font-bold">{t('everywhere.phone.title')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{workspace?.phoneDescription ?? t('everywhere.phone.description')}</p>
              </div>
              <PhoneShot
                src={`/home/phone-${tag}.webp`}
                alt={t('everywhere.phone.alt')}
                platformsLabel={t('everywhere.phone.platformsLabel')}
                storeSearch={t.rich('everywhere.phone.storeSearch', {
                  appName: tc('appName'),
                  strong: (chunks) => <strong className="block font-semibold text-foreground">{chunks}</strong>,
                })}
              />
            </div>
          </div>
        </Zone>

        <Zone id="collaborate">
          <Depth depth={t('collaborate.depth')} label={t('collaborate.label')} />
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className={zoneTitle}>{t('collaborate.title')}</h2>
              <ol className="mt-6 list-decimal space-y-4 pl-6 marker:font-mono marker:text-sm marker:text-muted-foreground">
                {(['submit', 'review', 'sync'] as const).map((step) => (
                  <li key={step} className="pl-1">
                    <h3 className="text-base font-bold">{t(`collaborate.${step}Title`)}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t(`collaborate.${step}Body`)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <Shot src={`/home/review-${tag}.webp`} alt={t('collaborate.alt')} width={959} height={locale === 'zh-CN' ? 287 : 303} />
          </div>
          <div className={`mt-10 grid gap-x-10 gap-y-6 border-t border-border pt-5 ${workspace ? 'md:grid-cols-2' : ''}`}>
            <div>
              <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-bold">
                <Users aria-hidden="true" className="size-5 shrink-0" />
                <span>{t('collaborate.sharedTitle')}</span>
                <span className="text-xs font-medium text-muted-foreground">{t('collaborate.sharedEdition')}</span>
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('collaborate.sharedBody')}</p>
            </div>
            {workspace && (
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold">
                  {workspace.icon}
                  <span>{workspace.title}</span>
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{workspace.description}</p>
              </div>
            )}
          </div>
        </Zone>

        <Zone id="govern">
          <Depth depth={t('govern.depth')} label={t('govern.label')} />
          <h2 className={zoneTitle}>{t('govern.title')}</h2>
          <div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Shot src={`/home/usage-${tag}.webp`} alt={t('govern.alt')} width={1100} height={599} />
            <ul className="flex flex-col">
              {(['usage', 'security', 'access'] as const).map((item) => (
                <li key={item} className="flex flex-col gap-1 border-t border-border py-5 last:border-b">
                  <h3 className="text-base font-bold">{t(`govern.${item}Title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`govern.${item}Body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </Zone>

        <div className="tide-deep">
          <Zone id="assets">
            <Depth depth={t('assets.depth')} label={t('assets.label')} />
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <h2 className={zoneTitle}>{t('assets.title')}</h2>
                <p className={zoneLede}>{t('assets.lede')}</p>
              </div>
              <figure className="min-w-0">
                {/* Layers settling: newest on top, each a shade darker as it goes down. */}
                <ol className="overflow-hidden rounded-xl ring-1 ring-border">
                  {STRATA.map((layer) => (
                    <li key={layer.workflow} className={`border-t border-border px-4 py-3 first:border-t-0 sm:px-5 ${layer.shade}`}>
                      <div className="flex items-baseline gap-3">
                        <span className="w-12 shrink-0 text-xs text-muted-foreground">{t(`assets.${layer.kind}`)}</span>
                        <span className="min-w-0 flex-1 text-sm font-semibold">{t(`assets.workflows.${layer.workflow}.name`)}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{layer.version}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t('assets.approval', { reviewer: t(`assets.workflows.${layer.workflow}.reviewer`) })}</span>
                        <time className="ml-auto whitespace-nowrap font-mono" dateTime={layer.approvedAt}>
                          {approvalDate.format(new Date(layer.approvedAt))}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
                <figcaption className="mt-3 text-sm text-muted-foreground">{t('assets.caption')}</figcaption>
              </figure>
            </div>
          </Zone>

          <Zone id="self-host">
            <Depth depth={t('pricing.depth')} label={t('pricing.label')} />
            <h2 className={zoneTitle}>{t('pricing.title')}</h2>
            <div className={`${cells} md:grid-cols-3`}>
              <div className="flex flex-col gap-3 bg-background p-6">
                <h3 className="text-lg font-bold">{t('pricing.openTitle')}</h3>
                <p className="text-base font-semibold">{t('pricing.openRate')}</p>
                <p className="flex-1 text-sm text-muted-foreground">{t('pricing.openBody')}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Button asChild>
                    <a href={communityRepo}>{t('pricing.repo')}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href="/docs/self-hosting">{t('pricing.guide')}</a>
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-3 bg-background p-6">
                <h3 className="text-lg font-bold">{t('pricing.hostedTitle')}</h3>
                <p className="text-base font-semibold">{t('pricing.hostedRate')}</p>
                <p className="text-sm text-muted-foreground">{t('pricing.hostedBody')}</p>
              </div>
              <div className="flex flex-col gap-3 bg-background p-6">
                <h3 className="text-lg font-bold">{t('pricing.enterpriseTitle')}</h3>
                <p className="text-base font-semibold">{t('pricing.enterpriseRate')}</p>
                <p className="flex-1 text-sm text-muted-foreground">{t('pricing.enterpriseBody')}</p>
                <div className="mt-2">
                  <Button asChild variant="outline">
                    <a href="mailto:support@dshteamwork.com">{t('pricing.contact')}</a>
                  </Button>
                </div>
              </div>
            </div>
          </Zone>

          <Zone id="faq">
            <Depth depth={t('faq.depth')} label={t('faq.label')} />
            <h2 className={zoneTitle}>{t('faq.title')}</h2>
            <div className="mt-10 max-w-3xl">
              {faqs.map((key) => (
                <details key={key} open={key === 'install'} className="group border-t border-border py-5 last:border-b">
                  <summary className="flex list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
                    {t(`faq.${key}.question`)}
                    <span aria-hidden="true" className="font-mono text-xl font-normal text-muted-foreground group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-muted-foreground">{t(`faq.${key}.answer`)}</p>
                </details>
              ))}
            </div>
          </Zone>

          <section id="seabed" className="tide-arrival">
            <WhalePod />
            <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
              <p className="mb-6 flex items-center gap-3 font-mono text-xs font-semibold tracking-wider">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
                {t('final.depth')}
                <span className="opacity-75">{t('final.label')}</span>
              </p>
              <h2 className={`${zoneTitle} whitespace-pre-line`}>{t('final.title')}</h2>
              <Button asChild size="lg" className="mt-8">
                <a href={start.href}>{start.label}</a>
              </Button>
            </div>
          </section>

          <SeaBed />
          <footer className="tide-footer">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 text-sm text-muted-foreground">
              <span className="inline-flex shrink-0 items-center gap-2 font-medium">
                <img src="/logo.svg" alt="" width={24} height={24} />
                {tc('appName')}
              </span>
              <nav aria-label={t('nav.label')} className="ml-auto flex flex-wrap items-center justify-end gap-x-4 sm:gap-x-6">
                <a href="/docs">{t('nav.docs')}</a>
                {legal && (
                  <>
                    <a href="/privacy">{tc('privacy')}</a>
                    <a href="/terms">{tc('terms')}</a>
                  </>
                )}
                <a href="#surface" className="tide-link">{t('woodcut.return')} <span aria-hidden="true">↑</span></a>
              </nav>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
