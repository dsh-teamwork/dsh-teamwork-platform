/**
 * The two summaries of a team (ADR 0049). The workspace's home
 * (`/teams/{teamId}/home`) is everyone's own, an admin's included: what waits
 * on the reader, their last 30 days and what the team changed lately. The
 * team overview (`/teams/{teamId}/overview`, Team management) is the admin's,
 * where an admin lands: what waits on the team, its last 30 days, getting
 * started until it is done, its resources and what to send a new member. Both
 * read `GET …/summary`, the home in its default scope, the caller's own, and
 * the overview with `scope=team`.
 *
 * Both open with connecting the reader's own DSH until it is done: a new team
 * already has a preset, and on the hosted service its models, so the first
 * thing anyone needs is their DSH signed in, then a browser or phone paired
 * with it. Done is read from the reader's computers on the relay
 * (`GET /relay/hosts`), not from calls, so the card moves on as soon as DSH
 * signs in.
 */

import { formatPoints } from '@dsh-teamwork/shared';
import { ArrowRight, Check, CircleCheck, CircleSlash, Gauge, GitPullRequestArrow, Laptop, MailWarning, ReceiptText, Smartphone, Tag } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useFormatter, useLocale, useNow, useTranslations } from 'use-intl';

import { CopyButton } from '@/components/copy-button';
import { Failure } from '@/components/page';
import { COMPUTERS_REFRESH_MS, ownComputers, PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Schemas, Team, TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

const LOGIN = '/teamwork login';
/** The plugin's npm name, what DSH installs (the plugin's README, "Install"). */
const PLUGIN = '@dsh-teamwork/dsh-teamwork';
/** The server the plugin signs in to unless told otherwise (the plugin's `DEFAULT_SERVER`); any other needs saying. */
const PLUGIN_DEFAULT_SERVER = 'https://www.dshteamwork.com';

type Summary = Schemas['TeamSummary'];
/** Whose summary a page shows: the reader's own, or the team's for its admin. */
type Scope = 'me' | 'team';

/** The workspace's home: the reader's own, whatever their role. */
export function TeamHomePage() {
  const { team } = useTeam();
  const t = useTranslations('team.overview');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const summary = useApi<Summary>(`teams/${team.id}/summary`);
  const dsh = useOwnDsh();
  const base = `/teams/${team.id}`;
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  const count = (kind: TeamConfig['kind']) => configs.data!.filter((c) => c.kind === kind).length;

  return (
    <>
      <PageHeader title={team.name} description={t('description')} />
      <ConnectDsh dsh={dsh} base={base} />
      <Waiting scope="me" summary={summary.data} base={base} />
      <Figures
        scope="me"
        summary={summary.data}
        last={{
          label: t('figures.resources'),
          value: configs.data.length,
          note: t('figures.resourcesNote', { models: count('model'), presets: count('preset'), plugins: count('plugin') }),
          href: `${base}/resources`,
        }}
      />
      <div className={cn('grid items-start gap-6', dsh.done && 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]')}>
        <Recent
          configs={configs.data}
          title={t('updates')}
          action={
            <Button asChild size="sm" variant="outline">
              <Link to={`${base}/resources`}>{t('allResources')}</Link>
            </Button>
          }
        />
        {dsh.done && <DshConnected dsh={dsh} base={base} />}
      </div>
    </>
  );
}

/** The admin's team overview, where an admin lands; a member never reaches it (`AdminOnly`). */
export function TeamOverviewPage() {
  const { team, passwords, teamSummary } = useTeam();
  const t = useTranslations('team');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const dsh = useOwnDsh();
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  const models = configs.data.filter((c) => c.kind === 'model').length;
  const base = `/teams/${team.id}`;
  // What a new team still lacks. Its preset is there from the start (the team assistant), and on the hosted service
  // its models too, so often only the members remain. A model is ready once it has a rate: no call reaches it before
  // (ADR 0050); a hosted model is priced by the service.
  const steps = [
    { key: 'model', hint: models > 0 ? 'hintRates' : 'hint', done: models > 0 && (teamSummary?.unpricedModels.length ?? 0) === 0, href: `${base}/models` },
    { key: 'members', hint: passwords ? 'hintPasswords' : 'hint', done: team.members.length > 1, href: `${base}/members` },
  ] as const;

  return (
    <>
      <PageHeader title={t('nav.overview')} description={t('overview.descriptionTeam')} />
      <ConnectDsh dsh={dsh} base={base} />
      <Waiting scope="team" summary={teamSummary} base={base} />
      <Figures
        scope="team"
        summary={teamSummary}
        last={{ label: t('overview.figures.members'), value: team.members.length, note: t('overview.figures.membersNote'), href: `${base}/members` }}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {!steps.every((s) => s.done) && <Setup steps={steps} />}
          <Resources configs={configs.data} base={base} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {dsh.done && <DshConnected dsh={dsh} base={base} />}
          <Invite team={team} base={base} />
        </div>
      </div>
    </>
  );
}

/** One thing that waits on the reader: what it is, and the page that deals with it where the reader may open one. */
interface Item {
  key: string;
  icon: ReactNode;
  text: string;
  href?: string;
}

/**
 * What waits, each with the page that deals with it; one line saying so when nothing does. The team's is the
 * admin's to act on; the reader's own is their submissions under review and the limits that apply to them. A
 * member cannot open the budgets page, so a limit is said, with whom to ask, rather than linked.
 */
function Waiting({ scope, summary, base }: { scope: Scope; summary?: Summary; base: string }) {
  const { team, me } = useTeam();
  const t = useTranslations('team.overview.waiting');
  const admin = team.role === 'admin';
  if (!summary) return <section aria-busy="true" className="h-14 rounded-lg border" />;

  const who = (limit: Summary['nearLimit'][number]) => {
    if (limit.scope === 'team') return t('scope.team');
    if (limit.scope === 'provider') return t('scope.provider', { name: limit.subjectId });
    if (limit.subjectId === me) return t('scope.you');
    return t('scope.member', { email: team.members.find((m) => m.userId === limit.subjectId)?.email ?? limit.subjectId });
  };
  const items: Item[] = [];
  // First, since it stops calls outright: models no call reaches until a rate is set.
  if (summary.unpricedModels.length > 0) {
    items.push({ key: 'unpriced', icon: <Tag className="size-4" aria-hidden />, text: t('unpricedModels', { count: summary.unpricedModels.length }), href: `${base}/models` });
  }
  // Then overruns, which stop budgeted calls on their model until reviewed.
  if (summary.overruns > 0) {
    items.push({ key: 'overruns', icon: <CircleSlash className="size-4" aria-hidden />, text: t('overruns', { count: summary.overruns }), href: `${base}/usage` });
  }
  if (summary.pendingReviews > 0) {
    items.push({
      key: 'reviews',
      icon: <GitPullRequestArrow className="size-4" aria-hidden />,
      text: t(scope === 'team' ? 'reviews' : 'reviewsMine', { count: summary.pendingReviews }),
      href: scope === 'team' ? `${base}/sharing` : `${base}/submissions`,
    });
  }
  for (const limit of summary.nearLimit) {
    items.push({
      key: `limit-${limit.scope}-${limit.subjectId}-${limit.period}`,
      icon: <Gauge className="size-4" aria-hidden />,
      text: t(limit.threshold >= 100 ? 'limitReached' : 'limitNear', { who: who(limit), threshold: limit.threshold, period: limit.period }),
      href: admin ? `${base}/budgets` : undefined,
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
  const row = 'flex items-center gap-3 px-4 py-3 text-sm';
  return (
    <section aria-labelledby="waiting" className="overflow-hidden rounded-lg border">
      <h2 id="waiting" className="flex items-center gap-2 border-b bg-muted px-4 py-2.5 text-sm font-semibold">
        {/* The page's one amber mark: something here waits on the reader (docs/design.md). */}
        <span aria-hidden className="size-1.5 rounded-full bg-signal" />
        {/* One's own submissions wait on an admin, not on oneself. */}
        {t(scope === 'team' ? 'title' : 'titleMember')}
        <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item.key} className="border-t first:border-t-0">
            {item.href ? (
              <Link to={item.href} className={cn(row, 'hover:bg-accent')}>
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1">{item.text}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ) : (
              <div className={row}>
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1">{item.text}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!admin && summary.nearLimit.length > 0 && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{t('askAdmin')}</p>}
    </section>
  );
}

/** One figure at the end of the row, which each page chooses, and the page that shows more of it. */
interface Figure {
  label: string;
  value: number;
  note: string;
  href: string;
}

/** The last 30 days at a glance: calls, points and the budget left to the reader, in the page's scope, then the page's own figure. */
function Figures({ scope, summary, last }: { scope: Scope; summary?: Summary; last: Figure }) {
  const t = useTranslations('team.overview.figures');
  const format = useFormatter();
  const locale = useLocale();
  const budget = summary?.budget;
  const cells: { label: string; value: ReactNode; note: string; href?: string }[] = [
    {
      label: t(scope === 'team' ? 'calls' : 'myCalls'),
      value: summary ? format.number(summary.calls) : '—',
      note: t('period'),
    },
    {
      label: t(scope === 'team' ? 'points' : 'myPoints'),
      value: summary ? formatPoints(summary.points, locale) : '—',
      note: summary && summary.unpriced > 0 ? t('unpriced', { count: summary.unpriced }) : t('period'),
    },
    {
      label: t('budget'),
      value: !budget ? '—' : budget.state === 'known' ? (budget.remaining !== null ? formatPoints(budget.remaining, locale) : '—') : t(`budgetState.${budget.state}`),
      note: budget?.resetAt ? t('resets', { at: format.dateTime(new Date(budget.resetAt), { dateStyle: 'medium' }) }) : t('budgetHint'),
    },
    { ...last, value: format.number(last.value) },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border lg:grid-cols-4">
      {cells.map((c, i) => {
        const body = (
          <>
            <dt className="text-sm text-muted-foreground">{c.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{c.value}</dd>
            <dd className="text-xs text-muted-foreground">{c.note}</dd>
          </>
        );
        const frame = cn('flex flex-col gap-0.5 p-4', i % 2 === 1 && 'border-l', i >= 2 && 'border-t lg:border-t-0', i === 2 && 'lg:border-l');
        return c.href ? (
          <Link key={c.label} to={c.href} className={cn(frame, 'hover:bg-accent')}>
            {body}
          </Link>
        ) : (
          <div key={c.label} className={frame}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

/** Getting a new team ready, shown to an admin until every step is done. */
function Setup({ steps }: { steps: readonly { key: 'model' | 'members'; hint: 'hint' | 'hintRates' | 'hintPasswords'; done: boolean; href: string }[] }) {
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
              <Mark n={i + 1} done={step.done} />
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

type RelayHost = Schemas['RelayHost'];

/** The reader's own DSH: their computers on the relay, most recently seen first, and how far connecting it has got. */
interface OwnDsh {
  /** Null until first read. */
  hosts: RelayHost[] | null;
  /** The computer whose DSH signed in to Teamwork last. */
  computer?: RelayHost;
  /** A browser or phone of the reader's is paired with one of them. */
  paired: boolean;
  /** Both, so the connect card gives way to one line. */
  done: boolean;
}

/** Reads the reader's computers, and again while connecting is not done, so the card moves on when DSH signs in. */
function useOwnDsh(): OwnDsh {
  const [hosts, setHosts] = useState<RelayHost[] | null>(null);
  // A relay that cannot be read leaves the steps showing, as for someone with no computer yet.
  const load = useCallback(() => ownComputers().then(setHosts, () => setHosts((known) => known ?? [])), []);
  const computer = hosts?.[0];
  const paired = (hosts ?? []).some((h) => h.pairings.some((p) => p.status === 'confirmed'));
  const done = !!computer && paired;
  useEffect(() => {
    void load();
    if (done) return;
    const timer = setInterval(() => void load(), COMPUTERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, done]);
  return { hosts, computer, paired, done };
}

/** Where this browser remembers that the reader put pairing off, per account: only the second step can be put off. */
const LATER_KEY = 'dsh-teamwork:connect-later:';

/**
 * Connecting the reader's own DSH, at the top of both summaries until it is done: sign DSH in to Teamwork on a computer,
 * then pair a browser (My DSH) or the phone app with it. Each step ticks itself off from the relay. Once DSH is signed in,
 * pairing can be put off; nothing shows until the computers are read.
 */
function ConnectDsh({ dsh, base }: { dsh: OwnDsh; base: string }) {
  const { me } = useTeam();
  const t = useTranslations('team.overview.dsh');
  const [later, setLater] = useState(() => {
    try {
      return localStorage.getItem(LATER_KEY + me) === '1';
    } catch {
      return false;
    }
  });
  if (!dsh.hosts || dsh.done || (dsh.computer && later)) return null;
  const server = window.location.origin;
  const code = (chunks: ReactNode) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{chunks}</code>;
  const signedIn = !!dsh.computer;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ol>
          <li className="flex gap-3 border-t px-6 py-4">
            <Mark n={1} done={signedIn} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className={cn('text-sm font-medium', signedIn && 'text-muted-foreground')}>{t('signIn.title')}</span>
              {signedIn ? (
                <span className="text-xs text-muted-foreground">{t('signIn.done', { name: dsh.computer!.name })}</span>
              ) : (
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <span>{t.rich('signIn.install', { link: (chunks) => <a href="/docs/install" className="text-foreground underline underline-offset-4">{chunks}</a> })}</span>
                  <Command text={PLUGIN} />
                  <span>{t('signIn.login')}</span>
                  <Command text={LOGIN} />
                  {/* The plugin signs in to the hosted service unless told otherwise: any other server is worth saying. */}
                  {server !== PLUGIN_DEFAULT_SERVER && <span className="[overflow-wrap:anywhere]">{t.rich('signIn.server', { server, code })}</span>}
                  <span className="text-xs">{t('signIn.waiting')}</span>
                </div>
              )}
            </div>
          </li>
          <li className="flex gap-3 border-t px-6 py-4">
            <Mark n={2} done={dsh.paired} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <span className="flex flex-col gap-0.5">
                <span className={cn('text-sm font-medium', !signedIn && 'text-muted-foreground')}>{t('pair.title')}</span>
                <span className="text-xs text-muted-foreground">{t('pair.hint')}</span>
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Laptop className="size-4 text-muted-foreground" aria-hidden />
                    {t('pair.browserTitle')}
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">{t('pair.browserBody')}</span>
                  <Button asChild size="sm" variant={signedIn ? 'default' : 'outline'} className="self-start">
                    <Link to={`${base}/my-dsh`}>{t('pair.browserAction')}</Link>
                  </Button>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Smartphone className="size-4 text-muted-foreground" aria-hidden />
                    {t('pair.phoneTitle')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('pair.phoneBody')}</span>
                </div>
              </div>
              {signedIn && (
                <button
                  type="button"
                  className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  onClick={() => {
                    try {
                      localStorage.setItem(LATER_KEY + me, '1');
                    } catch {
                      // Put off for this visit only.
                    }
                    setLater(true);
                  }}
                >
                  {t('pair.later')}
                </button>
              )}
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

/** The reader's DSH once connected: one line, opening it in My DSH. */
function DshConnected({ dsh, base }: { dsh: OwnDsh; base: string }) {
  const t = useTranslations('team.overview.dsh');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('connected')}
          </CardTitle>
          <span className="truncate text-xs text-muted-foreground">{t('connectedHint', { name: dsh.computer?.name ?? '' })}</span>
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to={`${base}/my-dsh`}>{t('open')}</Link>
        </Button>
      </CardHeader>
    </Card>
  );
}

/** For the admin: the instructions to send a new member, beside the members page where the invitation is made. */
function Invite({ team, base }: { team: Team; base: string }) {
  const t = useTranslations('team.overview');
  const { passwords } = useTeam();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inviteTitle')}</CardTitle>
        <CardDescription>{t(passwords ? 'inviteBodyPasswords' : 'inviteBody')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={`${base}/members`}>{t(passwords ? 'inviteActionPasswords' : 'inviteAction')}</Link>
        </Button>
        <CopyButton text={t('connectMessage', { team: team.name, server: window.location.origin })} label={t('copyMessage')} />
      </CardContent>
    </Card>
  );
}

/** A text to type into DSH, with its copy button. */
function Command({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 rounded-md border bg-muted py-1.5 pr-1.5 pl-3 font-mono text-sm text-foreground">
      <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{text}</span>
      <CopyButton text={text} />
    </span>
  );
}

/** A step's number, or its tick once done. */
function Mark({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
        done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

/** The team's resources for its admin: how many of each, each opening its page, and what changed last. */
function Resources({ configs, base }: { configs: TeamConfig[]; base: string }) {
  const t = useTranslations('team');
  const kinds = [
    { kind: 'model', path: 'models' },
    { kind: 'preset', path: 'presets' },
    { kind: 'plugin', path: 'plugins' },
  ] as const;
  return (
    <Recent
      configs={configs}
      title={t('overview.resources')}
      lead={
        <div className="grid grid-cols-3 border-t">
          {kinds.map(({ kind, path }, i) => (
            <Link key={kind} to={`${base}/${path}`} className={cn('flex flex-col gap-0.5 px-6 py-3 hover:bg-accent', i > 0 && 'border-l')}>
              <span className="text-xs text-muted-foreground">{t(`nav.${path}`)}</span>
              <span className="text-lg font-semibold tabular-nums">{configs.filter((c) => c.kind === kind).length}</span>
            </Link>
          ))}
        </div>
      }
    />
  );
}

/** The configuration edited last, newest first. Read from the rows that exist, so a removal does not show. */
function Recent({ configs, title, action, lead }: { configs: TeamConfig[]; title: string; action?: ReactNode; lead?: ReactNode }) {
  const t = useTranslations('team.overview');
  const tk = useTranslations('team.overview.kind');
  const format = useFormatter();
  const now = useNow();
  const recent = [...configs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {lead}
        {lead && <p className="border-t px-6 pt-3 pb-1 text-xs font-medium text-muted-foreground">{t('recent')}</p>}
        {recent.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">{t('recentEmpty')}</p>
        ) : (
          <ul>
            {recent.map((c) => (
              <li key={c.id} className={cn('flex items-baseline justify-between gap-3 px-6 py-2.5 text-sm', !lead && 'border-t')}>
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
