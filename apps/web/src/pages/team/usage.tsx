import { Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useLocale, useTranslations } from 'use-intl';

import { PageHeader } from '@/components/team/console-shell';
import { Select } from '@/components/ui/select';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { download, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';
import { UsageResolution } from './usage-resolution';

type Entry = Schemas['UsageEntry'];
type Page = { entries: Entry[]; total: number; page: number; size: number };

export function TeamUsagePage() {
  const { team, reloadSummary } = useTeam();
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
  const member = team.role === 'admin' ? params.get('userId') ?? '' : '';
  const [anchor] = useState(() => Date.now());
  const since = new Date(anchor - ({ day: 1, week: 7, month: 30 }[period] ?? 30) * 86400000).toISOString();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = new URLSearchParams({ since, page: String(page), size: '50' });
  if (member) query.set('userId', member);
  const usage = useApi<Page>(`teams/${team.id}/usage?${query}`);
  const update = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const names = new Map(team.members.map((m) => [m.userId, m.email || m.userId]));
  return <>
    <PageHeader title={t('title')} description={t(team.role === 'admin' ? 'descriptionAdmin' : 'descriptionMember')} action={<div className="flex gap-2"><Button variant="outline" disabled={exporting} onClick={() => {
      setExporting(true);
      const filters = new URLSearchParams(query);
      filters.delete('page'); filters.delete('size');
      void download(`teams/${team.id}/usage/export?${filters}`, 'teamwork-usage.csv').catch((error: unknown) => toast.error(word(error))).finally(() => setExporting(false));
    }}><Download />{t('export')}</Button><Button variant="outline" onClick={() => void usage.reload()}><RefreshCw />{t('refresh')}</Button></div>} />
    <div className="flex flex-wrap gap-2">
      <Select label={t('period')} value={period} options={(['day', 'week', 'month'] as const).map((value) => ({ value, label: t(`periods.${value}`) }))} change={(v) => update('period', v)} />
      {team.role === 'admin' && <Select label={t('member')} value={member} options={[{ value: '', label: t('allMembers') }, ...team.members.map((m) => ({ value: m.userId, label: m.email || m.userId }))]} change={(v) => update('userId', v)} />}
    </div>
    {!!usage.error && <p role="alert" className="text-sm text-destructive">{word(usage.error)}</p>}
    <Card className="overflow-hidden">
      {!usage.data ? !usage.error && <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p> : usage.data.entries.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p> : <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="border-b bg-muted text-xs text-muted-foreground"><tr>{(['when', 'member', 'model', 'input', 'cacheRead', 'output', 'points', 'status'] as const).map((key) => <th key={key} className="px-4 py-3 font-medium">{t(key)}</th>)}{team.role === 'admin' && <th className="px-4 py-3">{t('manage')}</th>}</tr></thead>
        <tbody>{usage.data.entries.map((row) => <tr key={row.id} className="border-b last:border-0">
          <td className="whitespace-nowrap px-4 py-3">{format.dateTime(new Date(row.createdAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="px-4 py-3">{names.get(row.userId) ?? t('formerMember')}</td><td className="px-4 py-3 font-medium">{what(row)}</td>
          <td className="px-4 py-3 tabular-nums">{row.input ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.cacheRead ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.output ?? '—'}</td>
          <td className="px-4 py-3 tabular-nums">{row.points ?? '—'}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{t(`states.${row.state}`)}</td>
          {team.role === 'admin' && <td className="px-4 py-3 text-right">{!row.meter && (row.state === 'pending' || row.state === 'unpriced' || row.code === 'usage_bound_exceeded') && <Button variant="ghost" size="sm" onClick={() => setResolving(row)}>{t(row.code === 'usage_bound_exceeded' ? 'reviewRoute' : 'resolve')}</Button>}</td>}
        </tr>)}</tbody>
      </table></div>}
    </Card>
    <p className="text-xs text-muted-foreground">{t('accountingHint')}</p>
    {usage.data && <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{t('count', { count: usage.data.total })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>{t('previous')}</Button><Button variant="outline" size="sm" disabled={page * usage.data.size >= usage.data.total} onClick={() => update('page', String(page + 1))}>{t('next')}</Button></div></div>}
    {resolving && <UsageResolution teamId={team.id} entry={resolving} reload={() => Promise.all([usage.reload(), reloadSummary()])} close={() => setResolving(null)} />}
  </>;
}
