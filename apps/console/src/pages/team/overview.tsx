/**
 * A team's overview (`/teams/{teamId}`): what it has, what an admin still has
 * to set up, what changed lately, and how a member connects DSH. Every figure
 * comes from the team's own rows; nothing here is tracked for it.
 */

import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useNow, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConfigOf, Provider, TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

const LOGIN = '/teamwork login';

type Preset = ConfigOf<'preset'>;

export function TeamOverviewPage() {
  const { team, passwords } = useTeam();
  const admin = team.role === 'admin';
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const providers = useApi<Provider[]>(admin ? `teams/${team.id}/providers` : null);
  const failed = (!configs.data && configs.error) || (admin && !providers.data && providers.error);
  if (failed) return <Failure message={word(failed)} />;
  if (!configs.data || (admin && !providers.data)) return null;
  // This instance's address: the plugin signs in to whichever server it is set to.
  return <Overview configs={configs.data} providerCount={providers.data?.length ?? 0} server={window.location.origin} passwords={passwords} />;
}

function Overview({
  configs,
  providerCount,
  server,
  passwords,
}: {
  configs: TeamConfig[];
  providerCount: number;
  server: string;
  /** Members get a first password from the admin instead of an invitation. */
  passwords: boolean;
}) {
  const { team } = useTeam();
  const t = useTranslations('team.overview');
  const tn = useTranslations('team.nav');
  const admin = team.role === 'admin';
  const count = (kind: TeamConfig['kind']) => configs.filter((c) => c.kind === kind).length;
  const base = `/teams/${team.id}`;
  const figures = [
    { label: tn('models'), value: count('model'), href: `${base}/models` },
    { label: tn('presets'), value: count('preset'), href: `${base}/presets` },
    { label: tn('plugins'), value: count('plugin'), href: `${base}/plugins` },
    { label: tn('members'), value: team.members.length, href: `${base}/members` },
  ];
  // In the order a new team gets ready: each step needs the one before it.
  const steps = [
    { key: 'provider', hint: 'hint', done: providerCount > 0, href: `${base}/models` },
    { key: 'model', hint: 'hint', done: count('model') > 0, href: `${base}/models` },
    { key: 'preset', hint: 'hint', done: count('preset') > 0, href: `${base}/presets` },
    { key: 'members', hint: passwords ? 'hintPasswords' : 'hint', done: team.members.length > 1, href: `${base}/members` },
  ] as const;
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader title={team.name} description={admin ? t('descriptionAdmin') : t('descriptionMember')} />

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {figures.map((f) => (
          <li key={f.label}>
            <Link to={f.href} className="flex flex-col gap-0.5 rounded-lg border bg-card p-4 transition-colors hover:border-ring">
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
                      <span className="text-xs text-muted-foreground">{t(`steps.${step.key}.${step.hint}`)}</span>
                    </span>
                    {!step.done && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={step.href}>{t('go')}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : (
          <PresetList configs={configs} base={base} />
        )}

        <div className="flex min-w-0 flex-col gap-6">
          <Connect admin={admin} server={server} />
          <Recent configs={configs} />
        </div>
      </div>
    </>
  );
}

/** How DSH joins: the command, to run (a member) or to send on (an admin). */
function Connect({ admin, server }: { admin: boolean; server: string }) {
  const t = useTranslations('team.overview');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{admin ? t('connectAdmin') : t('connectMember')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('connectHint', { server })}</p>
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
      onClick={async () => {
        // Unavailable (an insecure origin, say) or refused: the command stays selectable text beside the button.
        try {
          await navigator.clipboard.writeText(text);
          toast.success(t('copied'));
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      <Copy />
      {t('copy')}
    </Button>
  );
}

/** The configuration edited last, newest first. Read from the rows that exist, so a removal does not show. */
function Recent({ configs }: { configs: TeamConfig[] }) {
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
                <time dateTime={c.updatedAt} className="shrink-0 text-xs text-muted-foreground">
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
function PresetList({ configs, base }: { configs: TeamConfig[]; base: string }) {
  const t = useTranslations('team.overview');
  const presets = configs.filter((c): c is Preset => c.kind === 'preset');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t('presets')}</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to={`${base}/presets`}>{t('all')}</Link>
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
                {p.data.description && <span className="text-xs text-muted-foreground">{p.data.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
