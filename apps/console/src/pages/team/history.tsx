/** Time-based publication history and reviewed restoration of an individual resource. */
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Link } from 'react-router';
import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { api, download, type Schemas, type Team, type TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useTeam } from './layout';
type Revision = Schemas['ConfigRevision'];
export function TeamHistoryPage() {
  const { team } = useTeam();
  return (
    <History key={team.id} teamId={team.id} admin={team.role === 'admin'} members={team.members} />
  );
}
function History({
  teamId,
  admin,
  members,
}: {
  teamId: string;
  admin: boolean;
  members: Team['members'];
}) {
  const t = useTranslations('team.history');
  const word = useTeamError();
  const [kind, setKind] = useState('');
  const [configId, setConfigId] = useState('');
  const [author, setAuthor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [restore, setRestore] = useState<Revision | null>(null);
  const [restored, setRestored] = useState(false);
  const params = new URLSearchParams({ offset: String(offset) });
  if (kind) params.set('kind', kind);
  if (configId) params.set('configId', configId);
  if (author) params.set('authorId', author);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());
  const rows = useApi<Revision[]>(`teams/${teamId}/history?${params}`);
  const configs = useApi<TeamConfig[]>(`teams/${teamId}/configs`);
  const { pending, run } = useMutation(async () => {
    await Promise.all([rows.reload(), configs.reload()]);
  });
  const current = restore ? configs.data?.find((c) => c.id === restore.configId) : undefined;
  async function prepareRestore() {
    if (!restore) return;
    const ok = await run(
      () =>
        api(`teams/${teamId}/history/${restore.id}/restore`, {
          body: {
            baseVersion: current?.version ?? 0,
            note: t('restoreNote', { version: restore.version }),
          },
        }),
      t('draftCreated'),
    );
    if (ok) {
      setRestore(null);
      setRestored(true);
    }
  }
  if (!rows.data || !configs.data)
    return rows.error || configs.error ? (
      <Failure message={word(rows.error || configs.error)} />
    ) : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('hint')} />
      <p className="text-xs text-muted-foreground">
        {t('timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </p>
      <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-3">
        <NativeSelect
          aria-label={t('kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('allKinds')}</option>
          <option value="preset">{t('presets')}</option>
          <option value="plugin">{t('plugins')}</option>
        </NativeSelect>
        <NativeSelect
          aria-label={t('resourceId')}
          value={configId}
          onChange={(e) => {
            setConfigId(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('allResources')}</option>
          {[
            ...new Map([
              ...configs.data.map((c) => [c.id, c.name] as const),
              ...rows.data.map((r) => [r.configId, r.name] as const),
            ]).entries(),
          ].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('author')}
          value={author}
          onChange={(e) => {
            setAuthor(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('allAuthors')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.email ?? t('formerMember')}
            </option>
          ))}
        </NativeSelect>
        <label className="text-xs">
          {t('from')}
          <Input
            type="datetime-local"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="text-xs">
          {t('to')}
          <Input
            type="datetime-local"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      {restored && (
        <Link className="text-sm underline" to={`/teams/${teamId}/sharing`}>
          {t('openReview')}
        </Link>
      )}
      {rows.data.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {rows.data.map((row) => (
        <article key={row.id} className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">
              {row.name} · v{row.version}
            </h2>
            <time className="text-xs">{new Date(row.createdAt).toLocaleString()}</time>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`sources.${row.source}`)}
            {row.authorId
              ? ` · ${members.find((m) => m.userId === row.authorId)?.email ?? t('formerMember')}`
              : ''}
            {row.reviewerId
              ? ` · ${t('reviewedBy', { name: members.find((m) => m.userId === row.reviewerId)?.email ?? t('formerMember') })}`
              : ''}
          </p>
          {row.note && <p className="text-sm">{row.note}</p>}
          <details>
            <summary className="cursor-pointer text-sm">{t('compare')}</summary>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="text-xs">{t('historical')}</h3>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs">
                  {JSON.stringify({ name: row.name, data: row.data }, null, 2)}
                </pre>
              </div>
              <div>
                <h3 className="text-xs">{t('current')}</h3>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs">
                  {JSON.stringify(
                    configs.data?.find((c) => c.id === row.configId) ?? null,
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          </details>
          {admin && row.kind !== 'model' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    download(`teams/${teamId}/history/${row.id}/export`, `teamwork-${row.id}.tgz`),
                  )
                }
              >
                {t('export')}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => setRestore(row)}>
                {t('restore')}
              </Button>
            </div>
          )}
          {restore?.id === row.id && (
            <div className="rounded border p-3">
              <p className="mb-3 text-sm">
                {t('confirm', { version: row.version, base: current?.version ?? 0 })}
              </p>
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => void prepareRestore()}>
                  {t('prepare')}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setRestore(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={pending || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          disabled={pending || rows.data.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          {t('next')}
        </Button>
      </div>
    </>
  );
}
