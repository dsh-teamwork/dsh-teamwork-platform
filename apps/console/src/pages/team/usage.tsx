import { ChevronDown, RefreshCw } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';

type Entry = Schemas['UsageEntry'];
type Page = { entries: Entry[]; total: number; page: number; size: number };

function Filter({ label, value, options, change }: { label: string; value: string; options: { value: string; label: string }[]; change: (v: string) => void }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><Button variant="outline" aria-label={label}>{options.find((o) => o.value === value)?.label ?? label}<ChevronDown className="size-4" /></Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="start" sideOffset={5} className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {options.map((o) => <DropdownMenu.Item key={o.value} onSelect={() => change(o.value)} className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent">{o.label}</DropdownMenu.Item>)}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export function TeamUsagePage() {
  const { team } = useTeam();
  const t = useTranslations('usage');
  const word = useTeamError();
  const format = useFormatter();
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
    <PageHeader title={t('title')} description={t(team.role === 'admin' ? 'descriptionAdmin' : 'descriptionMember')} action={<Button variant="outline" onClick={() => void usage.reload()}><RefreshCw />{t('refresh')}</Button>} />
    <div className="flex flex-wrap gap-2">
      <Filter label={t('period')} value={period} options={(['day', 'week', 'month'] as const).map((value) => ({ value, label: t(`periods.${value}`) }))} change={(v) => update('period', v)} />
      {team.role === 'admin' && <Filter label={t('member')} value={member} options={[{ value: '', label: t('allMembers') }, ...team.members.map((m) => ({ value: m.userId, label: m.email || m.userId }))]} change={(v) => update('userId', v)} />}
    </div>
    {!!usage.error && <p role="alert" className="text-sm text-destructive">{word(usage.error)}</p>}
    <Card className="overflow-hidden">
      {!usage.data ? <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p> : usage.data.entries.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="border-b bg-muted text-xs text-muted-foreground"><tr>{(['when', 'member', 'model', 'input', 'cacheRead', 'output', 'points', 'status'] as const).map((key) => <th key={key} className="px-4 py-3 font-medium">{t(key)}</th>)}</tr></thead>
        <tbody>{usage.data.entries.map((row) => <tr key={row.id} className="border-b last:border-0">
          <td className="whitespace-nowrap px-4 py-3">{format.dateTime(new Date(row.createdAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td className="px-4 py-3">{names.get(row.userId) ?? t('formerMember')}</td><td className="px-4 py-3 font-medium">{row.model}</td>
          <td className="px-4 py-3 tabular-nums">{row.input ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.cacheRead ?? '—'}</td><td className="px-4 py-3 tabular-nums">{row.output ?? '—'}</td>
          <td className="px-4 py-3 tabular-nums">{row.points ?? '—'}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{t(`states.${row.state}`)}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
    <p className="text-xs text-muted-foreground">{t('accountingHint')}</p>
    {usage.data && <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{t('count', { count: usage.data.total })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>{t('previous')}</Button><Button variant="outline" size="sm" disabled={page * usage.data.size >= usage.data.total} onClick={() => update('page', String(page + 1))}>{t('next')}</Button></div></div>}
  </>;
}
