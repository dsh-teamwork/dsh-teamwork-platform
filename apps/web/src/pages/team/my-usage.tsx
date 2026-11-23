/**
 * Models and usage (`/teams/{teamId}/my-usage`), under Workspace for everyone,
 * an admin included (ADR 0049): the team's models and the reader's own use of
 * them. First the limits that apply to them now (`GET …/budgets`), then a
 * period's totals, every team model with its rate and what the reader spent on
 * it, each day's points (`GET …/usage/stats`, in the browser's time zone),
 * then their latest calls, with all of the period as CSV. Every read names the
 * reader, since an admin's unnamed read is the team's.
 */

import { formatPoints } from '@dsh-teamwork/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { ProviderMark } from '@/components/provider-mark';
import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { download, type Schemas, type TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';
import { ModelRateButton } from './model-rate';

type Stats = Schemas['UsageStats'];
type Budgets = { policies: Schemas['BudgetPolicy'][]; windows: Schemas['BudgetWindow'][] };
type Entry = Schemas['UsageEntry'];
type Page = { entries: Entry[]; total: number };

const PERIODS = [7, 30, 90] as const;
const DAY = 86_400_000;

export function TeamMyUsagePage() {
  const { team, me } = useTeam();
  const t = useTranslations('team.myUsage');
  const tu = useTranslations('usage');
  const word = useTeamError();
  const [params, setParams] = useSearchParams();
  const days = PERIODS.find((d) => String(d) === params.get('days')) ?? 30;
  // One instant for the whole page, so the stats, the calls and the CSV cover the same period.
  const [anchor] = useState(() => Date.now());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const period = new URLSearchParams({ userId: me, since: new Date(anchor - days * DAY).toISOString(), until: new Date(anchor).toISOString() });
  const stats = useApi<Stats>(`teams/${team.id}/usage/stats?${period}&timezone=${encodeURIComponent(zone)}`);
  const budgets = useApi<Budgets>(`teams/${team.id}/budgets`);
  const recent = useApi<Page>(`teams/${team.id}/usage?${period}&size=10`);
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const [exporting, setExporting] = useState(false);

  const failed = (!stats.data && stats.error) || (!budgets.data && budgets.error) || (!configs.data && configs.error);
  if (failed) return <Failure message={word(failed)} />;

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void download(`teams/${team.id}/usage/export?${period}`, 'teamwork-my-usage.csv')
                .catch((error: unknown) => toast.error(word(error)))
                .finally(() => setExporting(false));
            }}
          >
            <Download />
            {tu('export')}
          </Button>
        }
      />
      {budgets.data ? <Limits budgets={budgets.data} /> : <section aria-busy="true" className="h-24 rounded-lg border" />}

      <div role="tablist" aria-label={t('period')} className="flex w-fit rounded-lg border p-0.5">
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === days}
            onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set('days', String(d)); return next; }, { replace: true })}
            className={cn('rounded-md px-3 py-1.5 text-sm', d === days ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {t('days', { count: d })}
          </button>
        ))}
      </div>

      {stats.data && configs.data ? (
        <>
          <Totals stats={stats.data} />
          <Models stats={stats.data} configs={configs.data} />
          <Daily stats={stats.data} />
        </>
      ) : (
        <section aria-busy="true" className="h-64 rounded-lg border" />
      )}
      <Recent page={recent.data} stats={stats.data} />
    </>
  );
}

/** The limits that hold the reader now: the team's, the providers' and their own, each with its window. */
function Limits({ budgets }: { budgets: Budgets }) {
  const { me } = useTeam();
  const t = useTranslations('team.myUsage');
  const tw = useTranslations('team.overview.waiting.scope');
  const format = useFormatter();
  const locale = useLocale();
  // A member window follows the member's own policy, or the default one when they have none.
  const policyOf = (w: Schemas['BudgetWindow']) => {
    const enabled = budgets.policies.filter((p) => p.enabled && p.period === w.period);
    if (w.scope !== 'member') return enabled.find((p) => p.scope === w.scope && p.subjectId === w.subjectId);
    return enabled.find((p) => p.scope === 'member' && p.subjectId === me) ?? enabled.find((p) => p.scope === 'default_member');
  };
  const rows = budgets.windows
    .filter((w) => w.scope !== 'member' || w.subjectId === me)
    .map((w) => ({ window: w, policy: policyOf(w) }))
    .filter((r): r is { window: Schemas['BudgetWindow']; policy: Schemas['BudgetPolicy'] } => !!r.policy);
  const who = (w: Schemas['BudgetWindow']) => (w.scope === 'team' ? tw('team') : w.scope === 'provider' ? tw('provider', { name: w.subjectId }) : tw('you'));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('limits')}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {rows.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">{t('noLimits')}</p>
        ) : (
          <ul>
            {rows.map(({ window: w, policy: p }) => {
              const limit = w.pointLimit === null ? null : Number(w.pointLimit);
              const left = w.remaining === null ? null : Number(w.remaining);
              const tokens = p.total ?? null;
              const usedTokens = w.inputSpent + w.inputReserved + w.outputSpent + w.outputReserved;
              const share = limit && left !== null ? Math.min(1, Math.max(0, (limit - left) / limit)) : tokens ? Math.min(1, usedTokens / tokens) : 0;
              return (
                <li key={w.id} className="flex flex-col gap-2 border-t px-6 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">
                      {who(w)} · {t(w.period === 'day' ? 'today' : 'thisMonth')}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('resets', { at: format.dateTime(new Date(w.endsAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
                  </div>
                  <div
                    role="meter"
                    aria-label={`${who(w)} · ${t(w.period === 'day' ? 'today' : 'thisMonth')}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share * 100)}
                    className="h-1.5 overflow-hidden rounded-full bg-secondary"
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    {w.pointLimit !== null && <span>{t('pointsUsed', { used: formatPoints(w.spent, locale), limit: formatPoints(w.pointLimit, locale) })}</span>}
                    {w.remaining !== null && <span>{t('left', { left: formatPoints(w.remaining, locale) })}</span>}
                    {Number(w.reserved) > 0 && <span>{t('held', { held: formatPoints(w.reserved, locale) })}</span>}
                    {tokens !== null && <span>{t('tokensUsed', { used: format.number(usedTokens), limit: format.number(tokens) })}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The period's calls, points and tokens. */
function Totals({ stats }: { stats: Stats }) {
  const t = useTranslations('team.myUsage');
  const format = useFormatter();
  const locale = useLocale();
  const { totals } = stats;
  const cells = [
    { label: t('calls'), value: format.number(totals.calls), note: totals.unpriced > 0 ? t('unpriced', { count: totals.unpriced }) : t('callsNote') },
    { label: t('points'), value: formatPoints(totals.points, locale), note: t('pointsNote') },
    { label: t('input'), value: format.number(totals.input), note: t('inputNote', { cached: format.number(totals.cacheRead) }) },
    { label: t('output'), value: format.number(totals.output), note: t('outputNote', { reasoning: format.number(totals.reasoning) }) },
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

/**
 * Each day's points as columns from one baseline: one series, so no legend, in the neutral ink (navy is the team's).
 * Hovering or focusing a day reads it out above the plot; with none, the readout is the period's total.
 */
function Daily({ stats }: { stats: Stats }) {
  const t = useTranslations('team.myUsage');
  const format = useFormatter();
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const values = stats.days.map((d) => Number(d.points));
  const max = Math.max(0, ...values);
  const label = (day: string) => format.dateTime(new Date(`${day}T00:00:00`), { month: 'short', day: 'numeric' });
  const shown = active === null ? null : stats.days[active];
  const ticks = [0, Math.floor((stats.days.length - 1) / 2), stats.days.length - 1];
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle>{t('daily')}</CardTitle>
        <p aria-live="polite" className="text-sm tabular-nums">
          {shown ? (
            <>
              <span className="font-semibold">{t('dayPoints', { points: formatPoints(shown.points, locale) })}</span>{' '}
              <span className="text-muted-foreground">{t('dayDetail', { day: label(shown.day), calls: shown.calls })}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('peak', { points: formatPoints(max, locale) })}</span>
          )}
        </p>
      </CardHeader>
      <CardContent>
        {max === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('noUse')}</p>
        ) : (
          <>
            <div className="flex h-40 items-end gap-0.5 border-b" onPointerLeave={() => setActive(null)}>
              {stats.days.map((d, i) => (
                <button
                  key={d.day}
                  type="button"
                  aria-label={`${label(d.day)}: ${t('dayPoints', { points: formatPoints(d.points, locale) })}, ${t('dayCalls', { calls: d.calls })}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center focus-visible:outline-none"
                >
                  {/* At most 24px wide, 4px rounded at its tip and square on the baseline; the hit area is the whole column. */}
                  <span
                    className={cn('w-full max-w-6 rounded-t-[4px] bg-primary/75 group-hover:bg-primary group-focus-visible:bg-primary group-focus-visible:ring-2 group-focus-visible:ring-ring', active === i && 'bg-primary')}
                    style={{ height: `${(values[i] / max) * 100}%` }}
                  />
                </button>
              ))}
            </div>
            <div className="relative mt-1.5 h-4 text-xs text-muted-foreground">
              {ticks.map((i, n) => (
                <span key={n} className={cn('absolute', n === 0 ? 'left-0' : n === 1 ? 'left-1/2 -translate-x-1/2' : 'right-0')}>
                  {label(stats.days[i].day)}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Model = Extract<TeamConfig, { kind: 'model' }>;
type Source = Stats['sources'][number];

/**
 * Every team model, with its rate and what the reader spent on it in the period, most first and then the ones not
 * used; then what they spent on a model since removed and on each edition meter, which have no rate to show.
 */
function Models({ stats, configs }: { stats: Stats; configs: TeamConfig[] }) {
  const { team } = useTeam();
  const t = useTranslations('team.myUsage');
  const format = useFormatter();
  const locale = useLocale();
  const total = Number(stats.totals.points);
  const models = configs.filter((c): c is Model => c.kind === 'model');
  const spent = new Map(stats.sources.filter((s) => s.kind === 'model').map((s) => [s.key, s]));
  const rows: { key: string; model?: Model; source?: Source }[] = [
    ...models.map((model) => ({ key: model.id, model, source: spent.get(model.id) })),
    ...stats.sources.filter((s) => s.kind === 'meter' || !models.some((m) => m.id === s.key)).map((source) => ({ key: `${source.kind}:${source.key}`, source })),
  ].sort((a, b) => Number(b.source?.points ?? -1) - Number(a.source?.points ?? -1));
  const used = (source: Source | undefined, value: (s: Source) => string) => (source ? value(source) : '—');
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t('models')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('modelsHint')}</p>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('noModels')}</p>
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-y bg-muted text-xs text-muted-foreground">
              <tr>
                {(['model', 'rate', 'calls', 'points', 'share', 'input', 'output'] as const).map((key) => (
                  <th key={key} className={cn('px-4 py-2.5 font-medium', key !== 'model' && key !== 'rate' && 'text-right')}>
                    {t(`columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, model, source }) => {
                const meter = source?.kind === 'meter';
                const name = model?.name ?? (meter ? (source.labels[locale] ?? source.name) : source?.name ?? '');
                return (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      {meter ? (
                        <span className="font-medium">{name}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <ProviderMark hints={model ? [model.data.model, model.name, model.data.provider] : [name]} name={name} />
                          <span className="flex flex-col">
                            <span className="font-medium">{name}</span>
                            {model && <span className="text-xs text-muted-foreground">{model.data.model}</span>}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {model && <ModelRateButton teamId={team.id} configId={model.id} name={model.name} admin={false} provider={model.data.provider} model={model.data.model} />}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{meter ? '—' : used(source, (s) => format.number(s.calls))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{used(source, (s) => formatPoints(s.points, locale))}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{source && total > 0 ? format.number(Number(source.points) / total, { style: 'percent', maximumFractionDigits: 1 }) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{meter ? '—' : used(source, (s) => format.number(s.input))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{meter ? '—' : used(source, (s) => format.number(s.output))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The reader's latest calls in the period; the CSV in the header has all of them. */
function Recent({ page, stats }: { page?: Page; stats?: Stats }) {
  const t = useTranslations('team.myUsage');
  const tu = useTranslations('usage');
  const format = useFormatter();
  const locale = useLocale();
  // A call is named as its model is now, as the table above names it.
  const names = new Map((stats?.sources ?? []).filter((s) => s.kind === 'model').map((s) => [s.key, s.name]));
  const what = (row: Entry) => (row.meter ? (row.meter.labels[locale] ?? row.meter.name) : (names.get(row.configId) ?? row.model));
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle>{t('recent')}</CardTitle>
        {page && page.total > page.entries.length && <span className="text-xs text-muted-foreground">{t('recentMore', { count: page.total })}</span>}
      </CardHeader>
      {!page ? null : page.entries.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('noUse')}</p>
        </CardContent>
      ) : (
        <ul>
          {page.entries.map((row) => (
            <li key={row.id} className="flex items-baseline gap-3 border-t px-6 py-2.5 text-sm">
              <time dateTime={row.createdAt} className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
                {format.dateTime(new Date(row.createdAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </time>
              <span className="flex min-w-0 flex-1 items-center gap-2 self-center font-medium">
                {!row.meter && <ProviderMark hints={[row.model, what(row), row.provider]} name={what(row)} />}
                <span className="truncate">{what(row)}</span>
              </span>
              {!row.meter && (
                <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                  {t('tokens', { input: format.number(row.input ?? 0), output: format.number(row.output ?? 0) })}
                </span>
              )}
              <span className="w-24 shrink-0 text-right tabular-nums">{row.points !== null ? formatPoints(row.points, locale) : <span className="text-xs text-muted-foreground">{tu(`states.${row.state}`)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
