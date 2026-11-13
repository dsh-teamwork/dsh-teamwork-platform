import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Sea } from '@/components/home/sea';
import { LocalePicker } from '@/components/locale-picker';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/lib/auth';
import { hasLegalPages } from '@/lib/legal';
import { siteOrigin } from '@/lib/site';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/*
 * The home page every instance has: what DSH Teamwork is, as an open-source
 * project and as a service, and the one way in. It is one dive (docs/design.md):
 * a paper sky with the fluke sounding into the sea, then sections that sit
 * deeper and darker in one ocean gradient, each carrying its depth. It states
 * only what ships today. A deployment's legal pages are linked when it has
 * them (lib/legal.ts).
 */

const code = (chunks: ReactNode) => <code className="rounded bg-ocean-line px-1.5 py-0.5 font-mono text-[0.9em]">{chunks}</code>;

function Depth({ depth, label }: { depth: string; label: string }) {
  return (
    <p className="mb-6 flex items-center gap-3 font-mono text-xs font-semibold tracking-wider text-ocean-accent">
      {depth}
      <span className="text-ocean-muted">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 border-t border-dashed border-ocean-line" />
    </p>
  );
}

function Zone({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
      {children}
    </section>
  );
}

const zoneTitle = 'max-w-3xl text-balance text-3xl font-black tracking-tight sm:text-5xl sm:leading-tight';
const zoneLede = 'mt-5 max-w-2xl text-base text-ocean-muted sm:text-lg';

// The community edition: the open half of this product (ADR 0005), self-hosted.
const communityRepo = 'https://github.com/dsh-teamwork/dsh-teamwork-platform';

export default async function HomePage() {
  const [t, tc, user] = await Promise.all([getTranslations('home'), getTranslations('common'), currentUser()]);

  const origin = siteOrigin();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${origin}/#org`, name: tc('appName'), url: origin, logo: `${origin}/icon.png` },
      { '@type': 'WebSite', '@id': `${origin}/#site`, name: tc('appName'), url: origin, description: t('tagline'), publisher: { '@id': `${origin}/#org` } },
    ],
  };

  const start = user ? { href: '/teams', label: t('openConsole') } : { href: '/sign-in', label: tc('signIn') };
  const legal = hasLegalPages();
  const faqs = [1, 2, 3, 4, 5] as const;

  return (
    <>
      <script
        type="application/ld+json"
        // `<` escaped so nothing in a name can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <header className="mx-auto flex h-16 max-w-5xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <Image src="/logo.svg" alt="" width={30} height={30} priority />
          {tc('appName')}
        </Link>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground">{t('nav.how')}</a>
          <a href="#security" className="hover:text-foreground">{t('nav.security')}</a>
          <a href="#setup" className="hover:text-foreground">{t('nav.setup')}</a>
          <a href="#self-host" className="hover:text-foreground">{t('nav.selfhost')}</a>
          <a href="#faq" className="hover:text-foreground">{t('nav.faq')}</a>
        </nav>
        <Button asChild className="ml-auto">
          <Link href={start.href}>{start.label}</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto flex max-w-5xl flex-col gap-6 px-6 pt-14 sm:pt-24">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('eyebrow')}</p>
          <h1 className="max-w-3xl text-balance text-4xl font-black tracking-tight sm:text-6xl sm:leading-[1.08]">{t('title')}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{t('lede')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={start.href}>{start.label}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how">{t('nav.how')}</a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t.rich('hint', { code: (c) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{c}</code> })}
          </p>
        </section>

        <Sea />

        <div className="-mt-px bg-linear-to-b from-ocean to-ocean-deep text-ocean-foreground">
          <Zone id="how">
            <Depth depth={t('surface.depth')} label={t('surface.label')} />
            <h2 className={zoneTitle}>{t('surface.title')}</h2>
            <p className={zoneLede}>{t('surface.lede')}</p>
            <ol className="mt-12 grid gap-8 border-t border-ocean-line pt-6 md:grid-cols-3">
              {(['step1', 'step2', 'step3'] as const).map((step, i) => (
                <li key={step} className="flex flex-col gap-2">
                  <span className="font-mono text-sm font-semibold text-ocean-accent">0{i + 1}</span>
                  <h3 className="text-lg font-bold">{t(`surface.${step}Title`)}</h3>
                  <p className="text-sm text-ocean-muted">{t.rich(`surface.${step}Body`, { code })}</p>
                </li>
              ))}
            </ol>
            <figure className="mt-12 max-w-2xl">
              <figcaption className="mb-3 text-sm text-ocean-muted">{t('surface.terminalCaption')}</figcaption>
              <pre className="overflow-x-auto rounded-xl bg-ocean-deep p-5 font-mono text-[13px] leading-relaxed shadow-2xl ring-1 ring-ocean-line">
                <span className="text-ocean-accent">›</span> /teamwork login{'\n'}
                <span className="text-ocean-muted">{'  '}{t('surface.termConfirm')}</span>{'\n'}
                <span className="text-ocean-accent">✓</span> {t('surface.termSigned')}{'\n'}
                <span className="text-ocean-accent">›</span> /teamwork sync{'\n'}
                <span className="text-ocean-accent">✓</span> {t('surface.termSynced')}{'\n'}
                {'  '}team/coder      <span className="text-ocean-muted">{t('surface.termGateway')}</span>{'\n'}
                {'  '}team/reviewer   <span className="text-ocean-muted">{t('surface.termGateway')}</span>{'\n'}
                {'  '}pr-review       <span className="text-ocean-muted">→ team/reviewer</span>{'\n'}
                {'  '}@acme/dsh-lint  <span className="text-ocean-accent">@2.3.1</span>{'\n'}
                <span className="text-ocean-muted">{'  '}{t('surface.termNoKey')}</span>
              </pre>
            </figure>
          </Zone>

          <Zone id="security">
            <Depth depth={t('boundary.depth')} label={t('boundary.label')} />
            <h2 className={zoneTitle}>{t('boundary.title')}</h2>
            <p className={zoneLede}>{t('boundary.lede')}</p>
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl bg-ocean-line ring-1 ring-ocean-line md:grid-cols-3">
              {(['keys', 'check', 'gateway'] as const).map((item) => (
                <div key={item} className="flex flex-col gap-2 bg-ocean-deep/60 p-6">
                  <h3 className="text-base font-bold">{t(`boundary.${item}Title`)}</h3>
                  <p className="text-sm text-ocean-muted">{t(`boundary.${item}Body`)}</p>
                </div>
              ))}
            </div>
            <blockquote className="mt-12 border-t border-ocean-line pt-8">
              <p className="max-w-3xl text-balance text-xl font-bold sm:text-2xl">“{t('boundary.promise')}”</p>
              <p className="mt-3 font-mono text-xs text-ocean-muted">{t('boundary.promiseNote')}</p>
            </blockquote>
          </Zone>

          <Zone id="setup">
            <Depth depth={t('deep.depth')} label={t('deep.label')} />
            <h2 className={zoneTitle}>{t('deep.title')}</h2>
            <p className={zoneLede}>{t('deep.lede')}</p>
            <ol className="mt-12 max-w-3xl">
              {(
                [
                  ['presets', 'preset'],
                  ['plugins', 'plugin'],
                  ['models', 'model'],
                ] as const
              ).map(([layer, kind]) => (
                <li key={layer} className="grid grid-cols-[4.5rem_1fr] gap-4 border-t border-ocean-line py-5 last:border-b">
                  {/* The configuration kind as the product names it (`team_configs.kind`). */}
                  <span className="pt-1 font-mono text-xs font-semibold text-ocean-accent">{kind}</span>
                  <div>
                    <h3 className="text-base font-bold">{t(`deep.${layer}Title`)}</h3>
                    <p className="text-sm text-ocean-muted">{t(`deep.${layer}Body`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Zone>

          <Zone id="self-host">
            <Depth depth={t('community.depth')} label={t('community.label')} />
            <h2 className={zoneTitle}>{t('community.title')}</h2>
            <p className={zoneLede}>{t('community.lede')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-ocean-foreground text-ocean hover:bg-ocean-foreground/90">
                <a href={communityRepo}>{t('community.repo')}</a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-ocean-line bg-transparent text-ocean-foreground hover:bg-ocean-line">
                <a href={`${communityRepo}#self-hosting`}>{t('community.guide')}</a>
              </Button>
            </div>
          </Zone>

          <Zone id="faq">
            <Depth depth={t('faq.depth')} label={t('faq.label')} />
            <h2 className={zoneTitle}>{t('faq.title')}</h2>
            <div className="mt-10 max-w-3xl">
              {faqs.map((n) => (
                <details key={n} open={n === 1} className="group border-t border-ocean-line py-5 last:border-b">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
                    {t(`faq.q${n}`)}
                    <span aria-hidden="true" className="font-mono text-xl font-normal text-ocean-accent group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-ocean-muted">{t(`faq.a${n}`)}</p>
                </details>
              ))}
            </div>
          </Zone>

          <Zone>
            <Depth depth={t('final.depth')} label={t('final.label')} />
            <h2 className={zoneTitle}>{t('final.title')}</h2>
            <p className={zoneLede}>{t('final.lede')}</p>
            <Button asChild size="lg" className="mt-8 bg-ocean-foreground text-ocean hover:bg-ocean-foreground/90">
              <Link href={start.href}>{start.label}</Link>
            </Button>
          </Zone>

          <footer className="border-t border-ocean-line">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-8 text-sm text-ocean-muted">
              <span className="flex items-center gap-2 font-bold text-ocean-foreground">
                <Image src="/logo.svg" alt="" width={22} height={22} />
                {tc('appName')}
              </span>
              {legal && (
                <>
                  <Link href="/privacy" className="underline-offset-4 hover:underline">
                    {tc('privacy')}
                  </Link>
                  <Link href="/terms" className="underline-offset-4 hover:underline">
                    {tc('terms')}
                  </Link>
                </>
              )}
              <div className="ml-auto [&_select]:border-ocean-line [&_select]:bg-ocean-deep [&_select]:text-ocean-foreground [&_label]:text-ocean-muted">
                <LocalePicker />
              </div>
            </div>
          </footer>
        </div>
      </main>
    </>
  );
}
