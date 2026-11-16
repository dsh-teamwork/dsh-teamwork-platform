/** Team submissions: frozen contents, explicit review, and version conflict feedback. */
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, uploadArtifact, type Schemas, type Team, type TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { inspectPluginArchive, type PluginPreview } from '@/lib/plugin-archive';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useTeam } from './layout';

type Submission = Schemas['ResourceSubmission'];
export function TeamSharingPage() {
  const { team } = useTeam();
  return (
    <Sharing key={team.id} teamId={team.id} admin={team.role === 'admin'} members={team.members} />
  );
}
function Sharing({
  teamId,
  admin,
  members,
}: {
  teamId: string;
  admin: boolean;
  members: Team['members'];
}) {
  const t = useTranslations('team.sharing');
  const word = useTeamError();
  const { session } = useSession();
  const [offset, setOffset] = useState(0);
  const rows = useApi<Submission[]>(`teams/${teamId}/submissions?offset=${offset}`);
  const configs = useApi<TeamConfig[]>(`teams/${teamId}/configs`);
  const { pending, run } = useMutation(async () => {
    await Promise.all([rows.reload(), configs.reload()]);
  });
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<{
    row: Submission;
    action: 'approve' | 'reject' | 'withdraw';
  } | null>(null);
  const [plugin, setPlugin] = useState<{ file: File; preview: PluginPreview } | null>(null);
  const [pluginTarget, setPluginTarget] = useState('');
  const [editTarget, setEditTarget] = useState<{
    id?: string;
    revision?: number;
    configId?: string;
    baseVersion: number;
  } | null>(null);
  const [imported, setImported] = useState<Schemas['ConfigInput'] | null>(null);
  const [note, setNote] = useState('');
  const [importError, setImportError] = useState(false);
  async function decide() {
    if (!decision) return;
    const { row, action } = decision;
    if (
      await run(
        () =>
          api(`teams/${teamId}/submissions/${row.id}/${action}`, {
            body: { revision: row.revision, reason },
          }),
        t('done'),
      )
    ) {
      setDecision(null);
      setReason('');
    }
  }
  async function submitImported() {
    if (!imported) return;
    const ok = await run(async () => {
      const draft = await api<Submission>(
        editTarget?.id
          ? `teams/${teamId}/submissions/${editTarget.id}`
          : `teams/${teamId}/submissions`,
        {
          method: editTarget?.id ? 'PUT' : 'POST',
          body: {
            config: imported,
            configId: editTarget?.configId,
            baseVersion: editTarget?.baseVersion ?? 0,
            revision: editTarget?.revision,
            note,
          },
        },
      );
      await api(`teams/${teamId}/submissions/${draft.id}/submit`, {
        body: { revision: draft.revision },
      });
    }, t('submitted'));
    if (ok) {
      setImported(null);
      setEditTarget(null);
      setNote('');
    }
  }
  async function submitPlugin() {
    if (!plugin) return;
    const target = configs.data?.find((c) => c.id === pluginTarget);
    const ok = await run(async () => {
      const artifact = await uploadArtifact<Schemas['ResourceArtifact']>(teamId, plugin.file);
      if (artifact.sha256 !== plugin.preview.sha256) throw Error('Artifact mismatch');
      const config = {
        kind: 'plugin',
        name: target?.name ?? plugin.preview.package,
        data: {
          package: artifact.package,
          version: artifact.version,
          artifactId: artifact.id,
          sha256: artifact.sha256,
          description: note,
        },
      };
      const draft = await api<Submission>(`teams/${teamId}/submissions`, {
        body: { config, configId: target?.id, baseVersion: target?.version ?? 0, note },
      });
      await api(`teams/${teamId}/submissions/${draft.id}/submit`, {
        body: { revision: draft.revision },
      });
    }, t('submitted'));
    if (ok) {
      setPlugin(null);
      setNote('');
      setPluginTarget('');
    }
  }
  if (!rows.data || !configs.data)
    return rows.error || configs.error ? (
      <Failure message={word(rows.error || configs.error)} />
    ) : null;
  return (
    <>
      <PageHeader title={t('title')} description={admin ? t('adminHint') : t('memberHint')} />
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <label className="text-sm font-medium">
          {t('importPreset')}
          <input
            className="mt-2 block text-sm"
            type="file"
            accept=".json,application/json"
            disabled={pending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 65536) throw Error();
                const value = JSON.parse(await file.text()) as Schemas['ConfigInput'];
                if (value.kind !== 'preset' || typeof value.name !== 'string' || !value.data)
                  throw Error();
                setImported(value);
                setEditTarget(null);
                setImportError(false);
              } catch {
                setImportError(true);
              }
            }}
          />
        </label>
        {importError && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidFile')}
          </p>
        )}
        {imported && (
          <>
            <Input
              aria-label={t('resourceName')}
              value={imported.name}
              maxLength={120}
              onChange={(e) => setImported({ ...imported, name: e.target.value })}
            />
            {imported.kind === 'preset' && (
              <Textarea
                aria-label={t('prompt')}
                value={String((imported.data as Record<string, unknown>).systemPrompt ?? '')}
                onChange={(e) =>
                  setImported({
                    ...imported,
                    data: { ...imported.data, systemPrompt: e.target.value },
                  })
                }
              />
            )}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
              {JSON.stringify(imported.data, null, 2)}
            </pre>
            <Textarea
              aria-label={t('note')}
              placeholder={t('note')}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => void submitImported()}>
                {t('submit')}
              </Button>
              <Button variant="outline" onClick={() => setImported(null)}>
                {t('cancel')}
              </Button>
            </div>
          </>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <label className="text-sm font-medium">
          {t('importPlugin')}
          <input
            className="mt-2 block text-sm"
            type="file"
            accept=".tgz,.gz"
            disabled={pending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const preview = await inspectPluginArchive(file);
                setPlugin({ file, preview });
                setPluginTarget('');
                setImportError(false);
              } catch {
                setImportError(true);
              }
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">{t('uploadLimits')}</p>
        {plugin && (
          <>
            <h3 className="font-medium">
              {plugin.preview.package} @ {plugin.preview.version}
            </h3>
            <p className="break-all text-xs">SHA-256: {plugin.preview.sha256}</p>
            <details>
              <summary>{t('includedFiles', { count: plugin.preview.files.length })}</summary>
              <pre className="max-h-64 overflow-auto text-xs">
                {plugin.preview.files.join('\n')}
              </pre>
            </details>
            <NativeSelect
              aria-label={t('target')}
              value={pluginTarget}
              onChange={(e) => setPluginTarget(e.target.value)}
            >
              <option value="">{t('newPlugin')}</option>
              {configs.data
                .filter((c) => c.kind === 'plugin')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · v{c.version}
                  </option>
                ))}
            </NativeSelect>
            <Textarea
              aria-label={t('note')}
              placeholder={t('note')}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button disabled={pending} onClick={() => void submitPlugin()}>
              {t('uploadSubmit')}
            </Button>
          </>
        )}
      </section>
      {rows.data.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {rows.data.map((row) => (
        <article key={row.id} className="flex flex-col gap-3 border-t py-5">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">{row.proposal.name}</h2>
            <span className="flex items-center gap-1.5 text-sm">
              {row.state === 'pending' && <span aria-hidden className="size-1.5 rounded-full bg-signal" />}
              {t(`states.${row.state}`)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()} ·{' '}
            {members.find((m) => m.userId === row.authorId)?.email ?? t('formerMember')}
          </p>
          {row.note && <p className="whitespace-pre-wrap text-sm">{row.note}</p>}
          <details>
            <summary className="cursor-pointer text-sm">{t('compare')}</summary>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium">{t('current')}</h3>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs">
                  {JSON.stringify(
                    configs.data?.find((c) => c.id === row.configId) ?? null,
                    null,
                    2,
                  )}
                </pre>
              </div>
              <div>
                <h3 className="text-xs font-medium">{t('proposed')}</h3>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs">
                  {JSON.stringify(row.proposal, null, 2)}
                </pre>
              </div>
            </div>
            <p className="mt-2 text-xs">{t('baseVersion', { version: row.baseVersion })}</p>
          </details>
          {row.reason && <p className="whitespace-pre-wrap text-sm">{row.reason}</p>}
          {row.reviewerId && (
            <p className="text-xs text-muted-foreground">
              {t('reviewer')}:{' '}
              {members.find((m) => m.userId === row.reviewerId)?.email ?? t('formerMember')} ·{' '}
              {row.decidedAt ? new Date(row.decidedAt).toLocaleString() : ''}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {row.authorId === session.user?.id && row.state !== 'pending' && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  const current = configs.data?.find((c) => c.id === row.configId);
                  setImported(row.proposal);
                  setNote(row.note);
                  setEditTarget(
                    row.state === 'draft'
                      ? {
                          id: row.id,
                          revision: row.revision,
                          configId: current?.id,
                          baseVersion: row.baseVersion,
                        }
                      : { configId: current?.id, baseVersion: current?.version ?? 0 },
                  );
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {t('revise')}
              </Button>
            )}
            {row.state === 'draft' && row.authorId === session.user?.id && (
              <Button
                disabled={pending}
                onClick={() =>
                  void run(
                    () =>
                      api(`teams/${teamId}/submissions/${row.id}/submit`, {
                        body: { revision: row.revision },
                      }),
                    t('submitted'),
                  )
                }
              >
                {t('submit')}
              </Button>
            )}
            {row.state === 'pending' && admin && (
              <>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setDecision({ row, action: 'approve' });
                    setReason('');
                  }}
                >
                  {t('approve')}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setDecision({ row, action: 'reject' });
                    setReason('');
                  }}
                >
                  {t('reject')}
                </Button>
              </>
            )}
            {row.state === 'pending' && row.authorId === session.user?.id && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setDecision({ row, action: 'withdraw' });
                  setReason('');
                }}
              >
                {t('withdraw')}
              </Button>
            )}
          </div>
          {decision?.row.id === row.id && (
            <div className="flex flex-col gap-2 rounded border p-3">
              <p className="text-sm">
                {t('confirm', { name: row.proposal.name, action: t(decision.action) })}
              </p>
              <Textarea
                aria-label={t('reason')}
                placeholder={t('reason')}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  disabled={pending || (decision.action === 'reject' && !reason.trim())}
                  onClick={() => void decide()}
                >
                  {t('confirmAction')}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setDecision(null)}>
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
