/**
 * Usage (`/teams/{teamId}/usage`), an admin's: the team's usage at a glance for the period and member chosen — the
 * team's budget for the open window, the totals, each day's points, and who and which models spent them, each member
 * against their own budget (`GET …/usage/stats`, `GET …/budgets`) — then every call, with the period as CSV.
 */

import { formatPoints } from '@dsh-teamwork/shared';
import { Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { ProviderMark } from '@/components/provider-mark';
import { PageHeader } from '@/components/team/console-shell';
import { Select } from '@/components/ui/select';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { download, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';
import { Daily, Totals } from './my-usage';
import { UsageResolution } from './usage-resolution';

type Entry = Schemas['UsageEntry'];
type Page = { entries: Entry[]; total: number; page: number; size: number };
type Stats = Schemas['UsageStats'];
type Window = Schemas['BudgetWindow'];
type Budgets = { policies: Schemas['BudgetPolicy'][]; windows: Window[] };

export function TeamUsagePage() {
  const { team, reloadTeamSummary } = useTeam();
  const t = useTranslations('usage');
  const word = useTeamError();
  const format = useFormatter();
  const locale = useLocale();
  // A metered entry (ADR 0036) names what it measured in its registering edition's words.
  const what = (row: Entry) => !row.meter ? row.model
    : `${row.meter.labels[locale] ?? row.meter.name}${row.meter.quantity === null ? '' : ` · ${format.number(row.meter.quantity)} ${row.meter.unitLabels[locale] ?? row.meter.unit}`}`;
  const [resolving, setResolving] = useState<Entry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? 'month';
  const member = params.get('userId') ?? '';
  const [anchor] = useState(() => Date.now());
  const since = new Date(anchor - ({ day: 1, week: 7, month: 30 }[period] ?? 30) * 86400000).toISOString();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = new URLSearchParams({ since, page: String(page), size: '50' });
  if (member) query.set('userId', member);
  const usage = useApi<Page>(`teams/${team.id}/usage?${query}`);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const scope = new URLSearchParams({ since, until: new Date(anchor).toISOString(), timezone: zone });
  if (member) scope.set('userId', member);
  const stats = useApi<Stats>(`teams/${team.id}/usage/stats?${scope}`);
  const budgets = useApi<Budgets>(`teams/${team.id}/budgets`);
  const update = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const names = new Map(team.members.map((m) => [m.userId, m.email || m.userId]));
  return <>
    <PageHeader title={t('title')} description={t('description')} action={<div className="flex gap-2"><Button variant="outline" disabled={exporting} onClick={() => {
      setExporting(true);
      const filters = new URLSearchParams(query);
      filters.delete('page'); filters.delete('size');
      void download(`teams/${team.id}/usage/export?${filters}`, 'teamwork-usage.csv').catch((error: unknown) => toast.error(word(error))).finally(() => setExporting(false));
    }}><Download />{t('export')}</Button><Button variant="outline" onClick={() => void Promise.all([usage.reload(), stats.reload(), budgets.reload()])}><RefreshCw />{t('refresh')}</Button></div>} />
    <div className="flex flex-wrap gap-2">
      <Select label={t('period')} value={period} options={(['day', 'week', 'month'] as const).map((value) => ({ value, label: t(`periods.${value}`) }))} change={(v) => update('period', v)} />
      <Select label={t('member')} value={member} options={[{ value: '', label: t('allMembers') }, ...team.members.map((m) => ({ value: m.userId, label: m.email || m.userId }))]} change={(v) => update('userId', v)} />
    </div>
    {!!stats.error && <p role="alert" className="text-sm text-destructive">{word(stats.error)}</p>}
    {stats.data ? <UsageDashboard stats={stats.data} budgets={budgets.data} /> : !stats.error && <section aria-busy="true" className="h-64 rounded-lg border" />}
    <h2 className="pt-2 text-base font-semibold">{t('calls')}</h2>
    {!!usage.error && <p role="alert" className="text-sm text-destructive">{word(usage.error)}</p>}
    <Card className="overflow-hidden">
      {!usage.data ? !usage.error && <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p> : usage.data.entries.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p> : <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="border-b bg-muted text-xs text-muted-foreground"><tr>{(['when', 'member', 'model', 'input', 'cacheRead', 'output', 'points', 'status'] as const).map((key) => <th key={key} className="px-4 py-3 font-medium">{t(key)}</th>)}<th className="px-4 py-3">{t('manage')}</th></tr></thead>
        <tbody>{usage.data.entries.map((row) => <tr key={row.id} className="border-b last:border-0">
          <td className="whitespace-nowrap px-4 py-3">{format.dateTime(new Date(row.createdAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="px-4 py-3">{names.get(row.userId) ?? t('formerMember')}</td><td className="px-4 py-3 font-medium"><span className="flex items-center gap-2">{!row.meter && <ProviderMark hints={[row.model, row.provider]} name={row.model} />}{what(row)}</span></td>
          <td className="px-4 py-3 tabular-nums">{row.input ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.cacheRead ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.output ?? '—'}</td>
          <td className="px-4 py-3 tabular-nums">{row.points !== null ? formatPoints(row.points, locale) : '—'}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{t(`states.${row.state}`)}</td>
          <td className="px-4 py-3 text-right">{!row.meter && (row.state === 'pending' || row.state === 'unpriced' || row.code === 'usage_bound_exceeded') && <Button variant="ghost" size="sm" onClick={() => setResolving(row)}>{t(row.code === 'usage_bound_exceeded' ? 'reviewRoute' : 'resolve')}</Button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
    <p className="text-xs text-muted-foreground">{t('accountingHint')}</p>
    {usage.data && <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{t('count', { count: usage.data.total })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>{t('previous')}</Button><Button variant="outline" size="sm" disabled={page * usage.data.size >= usage.data.total} onClick={() => update('page', String(page + 1))}>{t('next')}</Button></div></div>}
    {resolving && <UsageResolution teamId={team.id} entry={resolving} reload={() => Promise.all([usage.reload(), reloadTeamSummary()])} close={() => setResolving(null)} />}
  </>;
}


function UsageDashboard({ stats, budgets }: { stats: Stats; budgets?: Budgets }) {
  const team = budgets?.windows.filter((w) => w.scope === 'team' && w.pointLimit !== null) ?? [];
  return (
    <>
      {team.map((w) => <TeamBudget key={w.id} window={w} />)}
      <Totals stats={stats} />
      <Daily stats={stats} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Members stats={stats} windows={budgets?.windows ?? []} />
        <Models stats={stats} />
      </div>
    </>
  );
}

/** The share of a window's points ceiling that is spent or held: 0 to 1. */
const used = (w: Window) => (w.pointLimit === null || Number(w.pointLimit) === 0 ? 0 : Math.min(1, (Number(w.spent) + Number(w.reserved)) / Number(w.pointLimit)));

function Meter({ share, label, warn }: { share: number; label: string; warn?: boolean }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} className="h-1.5 overflow-hidden rounded-full bg-secondary">
      <div className={warn && share >= 0.8 ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/** The team's open budget window: spent against its ceiling, and what is left. */
function TeamBudget({ window: w }: { window: Window }) {
  const t = useTranslations('usage.dashboard');
  const tm = useTranslations('team.myUsage');
  const format = useFormatter();
  const locale = useLocale();
  const share = used(w);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-muted-foreground">{t(w.period === 'day' ? 'teamToday' : 'teamMonth')}</span>
          <span className="text-xs text-muted-foreground">{tm('resets', { at: format.dateTime(new Date(w.endsAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 tabular-nums">
          <span className="text-3xl font-semibold">{format.number(share, { style: 'percent', maximumFractionDigits: 0 })}</span>
          <span className="text-sm">{tm('pointsUsed', { used: formatPoints(w.spent, locale), limit: formatPoints(w.pointLimit ?? '0', locale) })}</span>
          {w.remaining !== null && <span className="text-sm text-muted-foreground">{tm('left', { left: formatPoints(w.remaining, locale) })}</span>}
        </div>
        <Meter share={share} label={t(w.period === 'day' ? 'teamToday' : 'teamMonth')} warn />
      </CardContent>
    </Card>
  );
}

/** Who spent the period, most first, each against their own budget for the open window where one caps points. */
function Members({ stats, windows }: { stats: Stats; windows: Window[] }) {
  const { team } = useTeam();
  const t = useTranslations('usage.dashboard');
  const tu = useTranslations('usage');
  const format = useFormatter();
  const locale = useLocale();
  const names = new Map(team.members.map((m) => [m.userId, m.email || m.userId]));
  const total = Number(stats.totals.points);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t('members')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('membersHint')}</p>
      </CardHeader>
      {stats.members.length === 0 ? (
        <CardContent><p className="text-sm text-muted-foreground">{tu('empty')}</p></CardContent>
      ) : (
        <ul>
          {stats.members.map((m) => {
            const own = windows.find((w) => w.scope === 'member' && w.subjectId === m.userId && w.pointLimit !== null);
            const name = names.get(m.userId) ?? tu('formerMember');
            return (
              <li key={m.userId} className="flex flex-col gap-1.5 border-t px-6 py-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{name}</span>
                  <span className="shrink-0 tabular-nums">{t('pointsShare', { points: formatPoints(m.points, locale), share: format.number(total > 0 ? Number(m.points) / total : 0, { style: 'percent', maximumFractionDigits: 0 }) })}</span>
                </div>
                {own ? <Meter share={used(own)} label={`${name} · ${t('budget')}`} warn /> : null}
                <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
                  <span>{t('calls', { calls: m.calls })}</span>
                  <span>{t('tokens', { input: format.number(m.input), output: format.number(m.output) })}</span>
                  {own && <span>{t('budgetUsed', { used: formatPoints(own.spent, locale), limit: formatPoints(own.pointLimit ?? '0', locale) })}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Which models and meters spent the period, most first, as a share of its points. */
function Models({ stats }: { stats: Stats }) {
  const t = useTranslations('usage.dashboard');
  const tu = useTranslations('usage');
  const format = useFormatter();
  const locale = useLocale();
  const total = Number(stats.totals.points);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t('models')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('modelsHint')}</p>
      </CardHeader>
      {stats.sources.length === 0 ? (
        <CardContent><p className="text-sm text-muted-foreground">{tu('empty')}</p></CardContent>
      ) : (
        <ul>
          {stats.sources.map((s) => {
            const name = s.kind === 'meter' ? (s.labels[locale] ?? s.name) : s.name;
            const share = total > 0 ? Number(s.points) / total : 0;
            return (
              <li key={`${s.kind}:${s.key}`} className="flex flex-col gap-1.5 border-t px-6 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {s.kind === 'model' && <ProviderMark hints={[s.name]} name={s.name} />}
                    <span className="truncate">{name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{t('pointsShare', { points: formatPoints(s.points, locale), share: format.number(share, { style: 'percent', maximumFractionDigits: 0 }) })}</span>
                </div>
                <Meter share={share} label={name} />
                {s.kind === 'model' && (
                  <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
                    <span>{t('calls', { calls: s.calls })}</span>
                    <span>{t('tokens', { input: format.number(s.input), output: format.number(s.output) })}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
