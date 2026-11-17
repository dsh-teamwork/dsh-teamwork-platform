/**
 * A team's overview (`/teams/{teamId}`): what waits on the reader first, then
 * the last 30 days at a glance, then getting started (an admin, until it is
 * done) or the team's presets (a member), what changed lately, and how DSH
 * joins. What waits and the figures come from `GET …/summary`, scoped by the
 * server to the reader: an admin sees the team, a member their own.
 */

import { ArrowRight, Check, CircleCheck, Copy, Gauge, GitPullRequestArrow, MailWarning, ReceiptText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useNow, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConfigOf, Provider, Schemas, Team, TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

const LOGIN = '/teamwork login';

type Preset = ConfigOf<'preset'>;
type Summary = Schemas['TeamSummary'];

export function TeamOverviewPage() {
  const { team, passwords, summary } = useTeam();
  const admin = team.role === 'admin';
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const providers = useApi<Provider[]>(admin ? `teams/${team.id}/providers` : null);
  const failed = (!configs.data && configs.error) || (admin && !providers.data && providers.error);
  if (failed) return <Failure message={word(failed)} />;
  if (!configs.data || (admin && !providers.data)) return null;
  // This instance's address: the plugin signs in to whichever server it is set to.
  return <Overview configs={configs.data} providerCount={providers.data?.length ?? 0} server={window.location.origin} passwords={passwords} summary={summary} />;
}

function Overview({
  configs,
  providerCount,
  server,
  passwords,
  summary,
}: {
  configs: TeamConfig[];
  providerCount: number;
  server: string;
  /** Members get a first password from the admin instead of an invitation. */
  passwords: boolean;
  summary?: Summary;
}) {
  const { team } = useTeam();
  const t = useTranslations('team.overview');
  const admin = team.role === 'admin';
  const count = (kind: TeamConfig['kind']) => configs.filter((c) => c.kind === kind).length;
  const base = `/teams/${team.id}`;
  // In the order a new team gets ready: each step needs the one before it.
  const steps = [
    { key: 'provider', hint: 'hint', done: providerCount > 0, href: `${base}/models` },
    { key: 'model', hint: 'hint', done: count('model') > 0, href: `${base}/models` },
    { key: 'preset', hint: 'hint', done: count('preset') > 0, href: `${base}/presets` },
    { key: 'members', hint: passwords ? 'hintPasswords' : 'hint', done: team.members.length > 1, href: `${base}/members` },
  ] as const;
  const setupDone = steps.every((s) => s.done);

  return (
    <>
      <PageHeader title={team.name} description={admin ? t('descriptionAdmin') : t('descriptionMember')} />

      <Waiting summary={summary} base={base} />
      <Figures summary={summary} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {admin && !setupDone && <Setup steps={steps} />}
          {admin ? <Recent configs={configs} /> : <PresetList configs={configs} base={base} />}
        </div>
        <Connect admin={admin} server={server} team={team} />
      </div>
    </>
  );
}

/** One thing that waits on the reader: what it is, and where it is dealt with. */
interface Item {
  key: string;
  icon: ReactNode;
  text: string;
  href: string;
}

/** What waits on the reader, each with the page that deals with it; one line saying so when nothing does. */
function Waiting({ summary, base }: { summary?: Summary; base: string }) {
  const { team, me } = useTeam();
  const t = useTranslations('team.overview.waiting');
  const admin = team.role === 'admin';
  if (!summary) return <section aria-busy="true" className="h-14 rounded-lg border" />;

  const who = (scope: string, subjectId: string) => {
    if (scope === 'team') return t('scope.team');
    if (scope === 'provider') return t('scope.provider', { name: subjectId });
    if (subjectId === me) return t('scope.you');
    return t('scope.member', { email: team.members.find((m) => m.userId === subjectId)?.email ?? subjectId });
  };
  const items: Item[] = [];
  if (summary.pendingReviews > 0) {
    items.push({
      key: 'reviews',
      icon: <GitPullRequestArrow className="size-4" aria-hidden />,
      text: t(admin ? 'reviews' : 'reviewsMine', { count: summary.pendingReviews }),
      href: `${base}/sharing`,
    });
  }
  for (const w of summary.nearLimit) {
    items.push({
      key: `limit-${w.scope}-${w.subjectId}-${w.period}`,
      icon: <Gauge className="size-4" aria-hidden />,
      text: t(w.threshold >= 100 ? 'limitReached' : 'limitNear', { who: who(w.scope, w.subjectId), threshold: w.threshold, period: w.period }),
      href: `${base}/budgets`,
    });
  }
  if (summary.unresolved > 0) {
    items.push({ key: 'unresolved', icon: <ReceiptText className="size-4" aria-hidden />, text: t('unresolved', { count: summary.unresolved }), href: `${base}/usage` });
  }
  if (summary.failedNotices > 0) {
    items.push({ key: 'notices', icon: <MailWarning className="size-4" aria-hidden />, text: t('notices', { count: summary.failedNotices }), href: `${base}/budgets` });
  }

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        {t('none')}
      </p>
    );
  }
  return (
    <section aria-labelledby="waiting" className="overflow-hidden rounded-lg border">
      <h2 id="waiting" className="flex items-center gap-2 border-b bg-muted px-4 py-2.5 text-sm font-semibold">
        {/* The overview's one amber mark: something here waits on the reader (docs/design.md). */}
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        {/* A member's submissions wait on an admin, not on them. */}
        {t(admin ? 'title' : 'titleMember')}
        <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item.key} className="border-t first:border-t-0">
            <Link to={item.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
              <span className="text-muted-foreground">{item.icon}</span>
              <span className="min-w-0 flex-1">{item.text}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The last 30 days at a glance: calls, points, the budget left to the reader, and the team's size. */
function Figures({ summary }: { summary?: Summary }) {
  const { team } = useTeam();
  const t = useTranslations('team.overview.figures');
  const format = useFormatter();
  const admin = team.role === 'admin';
  const budget = summary?.budget;
  const cells = [
    {
      label: t(admin ? 'calls' : 'myCalls'),
      value: summary ? format.number(summary.calls) : '—',
      note: t('period'),
    },
    {
      label: t(admin ? 'points' : 'myPoints'),
      value: summary ? summary.points : '—',
      note: summary && summary.unpriced > 0 ? t('unpriced', { count: summary.unpriced }) : t('period'),
    },
    {
      label: t('budget'),
      value: !budget ? '—' : budget.state === 'known' ? (budget.remaining ?? '—') : t(`budgetState.${budget.state}`),
      note: budget?.resetAt ? t('resets', { at: format.dateTime(new Date(budget.resetAt), { dateStyle: 'medium' }) }) : t('budgetHint'),
    },
    { label: t('members'), value: format.number(team.members.length), note: t(admin ? 'membersAdmin' : 'membersMember') },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border lg:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.label} className={cn('flex flex-col gap-0.5 p-4', i % 2 === 1 && 'border-l', i >= 2 && 'border-t lg:border-t-0', i === 2 && 'lg:border-l')}>
          <dt className="text-sm text-muted-foreground">{c.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{c.value}</dd>
          <dd className="text-xs text-muted-foreground">{c.note}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Getting a new team ready, shown to an admin until every step is done. */
function Setup({ steps }: { steps: readonly { key: 'provider' | 'model' | 'preset' | 'members'; hint: 'hint' | 'hintPasswords'; done: boolean; href: string }[] }) {
  const t = useTranslations('team.overview');
  const done = steps.filter((s) => s.done).length;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t('setup')}</CardTitle>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
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
                  step.done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
                aria-hidden
              >
                {step.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>{t(`steps.${step.key}.title`)}</span>
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
  );
}

/**
 * How DSH joins, in three steps: install the plugin, point it at this server,
 * sign in. An admin can copy the whole of it to send to a new member.
 */
function Connect({ admin, server, team }: { admin: boolean; server: string; team: Team }) {
  const t = useTranslations('team.overview');
  const code = (chunks: ReactNode) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{chunks}</code>;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{admin ? t('connectAdmin') : t('connectMember')}</CardTitle>
        {admin && <CopyButton text={t('connectMessage', { team: team.name, server })} label={t('copyMessage')} />}
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3">
            <Step n={1} />
            <span className="text-muted-foreground">
              {t.rich('connectInstall', { link: (chunks) => <a href="/docs/install" className="text-foreground underline underline-offset-4">{chunks}</a> })}
            </span>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t.rich('connectServer', { server, code })}</span>
          </li>
          <li className="flex gap-3">
            <Step n={3} />
            <span className="flex min-w-0 flex-1 flex-col gap-2 text-muted-foreground">
              {t('connectSignIn')}
              <span className="flex items-center gap-2 rounded-md border bg-muted py-1.5 pr-1.5 pl-3 font-mono text-sm text-foreground">
                <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{LOGIN}</span>
                <CopyButton text={LOGIN} label={t('copy')} />
              </span>
            </span>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('team.overview');
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        // Unavailable (an insecure origin, say) or refused: the text stays selectable beside the button.
        try {
          await navigator.clipboard.writeText(text);
          toast.success(t('copied'));
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      <Copy />
      {label}
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
