'use client';

/**
 * A team's overview (`/teams/{teamId}`): what it has, what an admin still has
 * to set up, what changed lately, and how a member connects DSH. Every figure
 * comes from the team's own rows; nothing here is tracked for it.
 */

import type { TeamConfigView, TeamView } from '@dsh-teamwork/shared';
import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { PageHeader } from './console-shell';

const LOGIN = '/teamwork login';

export function Overview({ team, configs, providerCount }: { team: TeamView; configs: TeamConfigView[]; providerCount: number }) {
  const t = useTranslations('team.overview');
  const tn = useTranslations('team.nav');
  const admin = team.role === 'admin';
  const count = (kind: TeamConfigView['kind']) => configs.filter((c) => c.kind === kind).length;
  const base = `/teams/${team.id}`;
  const figures = [
    { label: tn('models'), value: count('model'), href: `${base}/models` },
    { label: tn('presets'), value: count('preset'), href: `${base}/presets` },
    { label: tn('plugins'), value: count('plugin'), href: `${base}/plugins` },
    { label: tn('members'), value: team.members.length, href: `${base}/members` },
  ];
  // In the order a new team gets ready: each step needs the one before it.
  const steps = [
    { key: 'provider', done: providerCount > 0, href: `${base}/models` },
    { key: 'model', done: count('model') > 0, href: `${base}/models` },
    { key: 'preset', done: count('preset') > 0, href: `${base}/presets` },
    { key: 'members', done: team.members.length > 1, href: `${base}/members` },
  ] as const;
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader title={team.name} description={admin ? t('descriptionAdmin') : t('descriptionMember')} />

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {figures.map((f) => (
          <li key={f.label}>
            <Link href={f.href} className="flex flex-col gap-0.5 rounded-lg border bg-card p-4 transition-colors hover:border-ring">
              <span className="text-2xl font-semibold tabular-nums">{f.value}</span>
              <span className="text-sm text-muted-foreground">{f.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {admin ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{t('setup')}</CardTitle>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', done === steps.length ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground')}>
                {done} / {steps.length}
              </span>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <ol>
                {steps.map((step, i) => (
                  <li key={step.key} className="flex items-center gap-3 border-t px-6 py-3">
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                        step.done ? 'border-brand bg-brand text-brand-foreground' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {step.done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('text-sm font-medium', step.done && 'text-muted-foreground line-through')}>{t(`steps.${step.key}.title`)}</span>
                      <span className="text-xs text-muted-foreground">{t(`steps.${step.key}.hint`)}</span>
                    </span>
                    {!step.done && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={step.href}>{t('go')}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : (
          <Presets configs={configs} base={base} />
        )}

        <div className="flex min-w-0 flex-col gap-6">
          <Connect admin={admin} />
          <Recent configs={configs} />
        </div>
      </div>
    </>
  );
}

/** How DSH joins: the command, to run (a member) or to send on (an admin). */
function Connect({ admin }: { admin: boolean }) {
  const t = useTranslations('team.overview');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{admin ? t('connectAdmin') : t('connectMember')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('connectHint')}</p>
        <div className="flex items-center gap-2 rounded-md border bg-muted py-1.5 pr-1.5 pl-3 font-mono text-sm">
          <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{LOGIN}</span>
          <CopyButton text={LOGIN} />
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations('team.overview');
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        // Unavailable (an insecure origin, say): the command stays selectable text beside the button.
        navigator.clipboard?.writeText(text).then(() => toast.success(t('copied')), () => undefined);
      }}
    >
      <Copy />
      {t('copy')}
    </Button>
  );
}

/** The configuration that changed last, newest first: the team's own record of it. */
function Recent({ configs }: { configs: TeamConfigView[] }) {
  const t = useTranslations('team.overview');
  const tk = useTranslations('team.overview.kind');
  const format = useFormatter();
  const now = useNow();
  const recent = [...configs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recent')}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {recent.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">{t('recentEmpty')}</p>
        ) : (
          <ul>
            {recent.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-3 border-t px-6 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{tk(c.kind)}</span> {c.name}{' '}
                  <span className="text-xs text-muted-foreground tabular-nums">v{c.version}</span>
                </span>
                <time dateTime={c.updatedAt} className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                  {format.relativeTime(new Date(c.updatedAt), now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** For a member: what the team shares, with a way to see more. */
function Presets({ configs, base }: { configs: TeamConfigView[]; base: string }) {
  const t = useTranslations('team.overview');
  const presets = configs.filter((c) => c.kind === 'preset');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t('presets')}</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/presets`}>{t('all')}</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {presets.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">{t('noPresets')}</p>
        ) : (
          <ul>
            {presets.map((p) => (
              <li key={p.id} className="flex flex-col border-t px-6 py-2.5 text-sm">
                <span className="font-medium">{p.name}</span>
                {p.kind === 'preset' && p.data.description && <span className="text-xs text-muted-foreground">{p.data.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
