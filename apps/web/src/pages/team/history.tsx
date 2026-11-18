/**
 * Versions and backups (`/teams/{teamId}/history`): every publication of the
 * team's resources as a timeline, newest first, filtered in one row (kind,
 * resource, author, time range). Each version opens to show what restoring it
 * would change, field by field (components/team/config-diff.tsx); an admin can
 * export it with what it depends on, or prepare a restore, which becomes a
 * draft that goes through review like any other change.
 */

import { ChevronRight, Download, History as HistoryIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useFormatter, useNow, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { ConfigDiff } from '@/components/team/config-diff';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, download, type Schemas, type Team, type TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type Revision = Schemas['ConfigRevision'];
type Range = 'any' | '7' | '30' | 'custom';

const PAGE = 50;
const DAY = 86_400_000;

export function TeamHistoryPage() {
  const { team } = useTeam();
  return <History key={team.id} team={team} />;
}

function History({ team }: { team: Team }) {
  const t = useTranslations('team.history');
  const word = useTeamError();
  const [kind, setKind] = useState('');
  const [configId, setConfigId] = useState('');
  const [author, setAuthor] = useState('');
  const [range, setRange] = useState<Range>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  // Read once, so a quick range stays the same window while the reader pages through it.
  const [anchor] = useState(() => Date.now());
  const [restore, setRestore] = useState<Revision | null>(null);

  const params = new URLSearchParams({ offset: String(offset) });
  if (kind) params.set('kind', kind);
  if (configId) params.set('configId', configId);
  if (author) params.set('authorId', author);
  if (range === '7' || range === '30') params.set('from', new Date(anchor - Number(range) * DAY).toISOString());
  if (range === 'custom' && from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  // A custom end date counts the whole of that day.
  if (range === 'custom' && to) params.set('to', new Date(new Date(`${to}T00:00:00`).getTime() + DAY).toISOString());
  const rows = useApi<Revision[]>(`teams/${team.id}/history?${params}`);
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
  };

  const failed = (!rows.data && rows.error) || (!configs.data && configs.error);
  if (failed) return <Failure message={word(failed)} />;
  const names = new Map((configs.data ?? []).map((c) => [c.id, c.name]));
  const resources = [...new Map([...(configs.data ?? []).filter((c) => c.kind !== 'model').map((c) => [c.id, c.name] as const), ...(rows.data ?? []).map((r) => [r.configId, r.name] as const)]).entries()];

  return (
    <>
      <PageHeader title={t('title')} description={t('hint')} />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={t('kind')}
          value={kind}
          options={[
            { value: '', label: t('allKinds') },
            { value: 'preset', label: t('presets') },
            { value: 'plugin', label: t('plugins') },
          ]}
          change={filter(setKind)}
        />
        <Select label={t('resourceId')} value={configId} options={[{ value: '', label: t('allResources') }, ...resources.map(([id, name]) => ({ value: id, label: name }))]} change={filter(setConfigId)} />
        <Select
          label={t('author')}
          value={author}
          options={[{ value: '', label: t('allAuthors') }, ...team.members.map((m) => ({ value: m.userId, label: m.email ?? t('formerMember') }))]}
          change={filter(setAuthor)}
        />
        <Select
          label={t('range')}
          value={range}
          options={(['any', '7', '30', 'custom'] as const).map((value) => ({ value, label: t(`ranges.${value}`) }))}
          change={filter((v: string) => setRange(v as Range))}
        />
        {range === 'custom' && (
          <span className="flex items-center gap-2">
            <Input type="date" aria-label={t('from')} value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} className="w-auto" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label={t('to')} value={to} min={from || undefined} onChange={(e) => filter(setTo)(e.target.value)} className="w-auto" />
          </span>
        )}
      </div>

      {!rows.data || !configs.data ? null : rows.data.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="relative flex flex-col">
          {/* The timeline's spine. */}
          <span aria-hidden className="absolute top-4 bottom-4 left-[11px] w-px bg-border" />
          {rows.data.map((row) => (
            <RevisionRow key={row.id} row={row} team={team} current={configs.data?.find((c) => c.id === row.configId) ?? null} names={names} onRestore={() => setRestore(row)} />
          ))}
        </ol>
      )}

      {rows.data && (offset > 0 || rows.data.length === PAGE) && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t('previous')}
          </Button>
          <Button variant="outline" size="sm" disabled={rows.data.length < PAGE} onClick={() => setOffset(offset + PAGE)}>
            {t('next')}
          </Button>
        </div>
      )}

      {restore && (
        <RestoreDialog
          teamId={team.id}
          row={restore}
          current={configs.data?.find((c) => c.id === restore.configId) ?? null}
          reload={() => Promise.all([rows.reload(), configs.reload()])}
          onClose={() => setRestore(null)}
        />
      )}
    </>
  );
}

function RevisionRow({ row, team, current, names, onRestore }: { row: Revision; team: Team; current: TeamConfig | null; names: ReadonlyMap<string, string>; onRestore: () => void }) {
  const t = useTranslations('team.history');
  const tk = useTranslations('team.overview.kind');
  const format = useFormatter();
  const now = useNow();
  const { pending, run } = useMutation(async () => undefined);
  const who = (id: string) => team.members.find((m) => m.userId === id)?.email ?? t('formerMember');
  const live = current?.version === row.version;

  return (
    <li className="relative pl-9">
      <span aria-hidden className={cn('absolute top-4 left-1.5 size-3 rounded-full border-2 bg-background', live ? 'border-brand' : 'border-input')} />
      <details className="group rounded-lg hover:bg-accent/50 open:bg-muted/40">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{row.name}</span>
              <span className="font-mono text-xs text-muted-foreground">v{row.version}</span>
              <span className="text-xs text-muted-foreground">{tk(row.kind)}</span>
              {live && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{t('live')}</span>}
            </span>
            <span className="text-xs text-muted-foreground">
              {t(`sources.${row.source}`)}
              {row.authorId && ` · ${who(row.authorId)}`}
              {row.reviewerId && ` · ${t('reviewedBy', { name: who(row.reviewerId) })}`}
              {row.note && ` · ${row.note}`}
            </span>
          </span>
          <time dateTime={row.createdAt} title={format.dateTime(new Date(row.createdAt), { dateStyle: 'medium', timeStyle: 'short' })} className="shrink-0 text-xs text-muted-foreground">
            {format.relativeTime(new Date(row.createdAt), now)}
          </time>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="flex flex-col gap-4 px-3 pb-4">
          {live ? (
            <p className="text-sm text-muted-foreground">{t('isLive')}</p>
          ) : (
            <ConfigDiff
              before={current ? { name: current.name, data: current.data } : null}
              after={{ name: row.name, data: row.data }}
              names={names}
              beforeLabel={current ? t('currentVersion', { version: current.version }) : t('deleted')}
              afterLabel={t('thisVersion', { version: row.version })}
            />
          )}
          {row.kind !== 'model' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(() => download(`teams/${team.id}/history/${row.id}/export`, `teamwork-${row.id}.tgz`))}>
                <Download />
                {t('export')}
              </Button>
              {!live && (
                <Button size="sm" variant="outline" onClick={onRestore}>
                  <RotateCcw />
                  {t('restore')}
                </Button>
              )}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/** Restoring prepares a draft on top of the version live now; nothing changes until it is reviewed. */
function RestoreDialog({ teamId, row, current, reload, onClose }: { teamId: string; row: Revision; current: TeamConfig | null; reload: () => Promise<unknown>; onClose: () => void }) {
  const t = useTranslations('team.history');
  const { pending, run } = useMutation(reload);
  const [done, setDone] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4" aria-hidden />
            {t('restoreTitle', { name: row.name, version: row.version })}
          </DialogTitle>
          <DialogDescription>{done ? t('draftCreated') : t('confirm', { version: row.version, base: current?.version ?? 0 })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {done ? (
            <Button asChild>
              <Link to={`/teams/${teamId}/sharing`}>{t('openReview')}</Link>
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button
                disabled={pending}
                onClick={async () => {
                  const ok = await run(
                    () => api(`teams/${teamId}/history/${row.id}/restore`, { body: { baseVersion: current?.version ?? 0, note: t('restoreNote', { version: row.version }) } }),
                    t('draftCreated'),
                  );
                  if (ok) setDone(true);
                }}
              >
                {t('prepare')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
