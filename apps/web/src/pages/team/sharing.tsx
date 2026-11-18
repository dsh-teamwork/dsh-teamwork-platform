/**
 * Submissions and review: members submit presets and plugin packages, and an
 * admin approves the exact contents before the team gets them. One page in two
 * places (ADR 0043): under Work, `/teams/{teamId}/submissions` is the reader's
 * own submissions and where they send new ones; under Team assets,
 * `/teams/{teamId}/sharing` is the admin's review queue, opening on what
 * waits, with the team's whole history one tab away. Submitting a preset or a
 * plugin happens in a dialog; each submission is a row that opens to show,
 * field by field, what it would change (components/team/config-diff.tsx), and
 * the actions its state allows.
 */

import { ChevronRight, FileJson, Layers, Package, Puzzle, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { ConfigDiff } from '@/components/team/config-diff';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, uploadArtifact, type Schemas, type Team, type TeamConfig } from '@/lib/api';
import { inspectPluginArchive, type PluginPreview } from '@/lib/plugin-archive';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type Submission = Schemas['ResourceSubmission'];
type Proposal = Schemas['ConfigInput'];
type Reload = () => Promise<unknown>;
/** Where a revised proposal goes: back into its own draft, or a new submission on the resource as it is now. */
interface Target {
  id?: string;
  revision?: number;
  configId?: string;
  baseVersion: number;
}

const PAGE = 50;

export function TeamSharingPage({ view }: { view: 'mine' | 'review' }) {
  const { team } = useTeam();
  return <Sharing key={`${team.id}-${view}`} team={team} review={view === 'review'} />;
}

function Sharing({ team, review }: { team: Team; review: boolean }) {
  const t = useTranslations('team.sharing');
  const tn = useTranslations('team.nav');
  const word = useTeamError();
  const { reloadSummary } = useTeam();
  // The review queue opens on what waits; one's own submissions on everything sent.
  const [tab, setTab] = useState<'pending' | 'all'>(review ? 'pending' : 'all');
  const [offset, setOffset] = useState(0);
  const rows = useApi<Submission[]>(`teams/${team.id}/submissions?offset=${offset}${tab === 'pending' ? '&state=pending' : ''}${review ? '' : '&mine=true'}`);
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  // A decision or a submission changes what waits for review, so the sidebar's dot reads again too.
  const reload = () => Promise.all([rows.reload(), configs.reload(), reloadSummary()]);
  const [dialog, setDialog] = useState<{ kind: 'preset'; proposal?: Proposal; note?: string; target?: Target } | { kind: 'plugin' } | null>(null);

  const failed = (!rows.data && rows.error) || (!configs.data && configs.error);
  if (failed) return <Failure message={word(failed)} />;
  const names = new Map((configs.data ?? []).map((c) => [c.id, c.name]));
  const tabs = review ? (['pending', 'all'] as const) : (['all', 'pending'] as const);

  return (
    <>
      <PageHeader
        title={tn(review ? 'sharing' : 'submissions')}
        description={review ? t('adminHint') : t('memberHint')}
        action={
          !review && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog({ kind: 'plugin' })}>
                <Upload />
                {t('uploadPlugin')}
              </Button>
              <Button onClick={() => setDialog({ kind: 'preset' })}>
                <FileJson />
                {t('submitPreset')}
              </Button>
            </div>
          )
        }
      />

      <div role="tablist" aria-label={tn(review ? 'sharing' : 'submissions')} className="flex w-fit rounded-lg border p-0.5">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setOffset(0);
            }}
            className={cn('rounded-md px-3 py-1.5 text-sm', tab === key ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {t(key === 'pending' ? 'tabPending' : review ? 'tabAll' : 'tabMine')}
          </button>
        ))}
      </div>

      {!rows.data || !configs.data ? null : rows.data.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">{t(tab === 'pending' ? 'emptyPending' : 'empty')}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border">
          {rows.data.map((row) => (
            <SubmissionRow
              key={row.id}
              row={row}
              team={team}
              current={configs.data?.find((c) => c.id === row.configId) ?? null}
              names={names}
              reload={reload}
              revise={(target) => setDialog({ kind: 'preset', proposal: row.proposal, note: row.note, target })}
            />
          ))}
        </ul>
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

      {dialog?.kind === 'preset' && (
        <PresetDialog teamId={team.id} initial={dialog.proposal} initialNote={dialog.note} target={dialog.target} reload={reload} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'plugin' && configs.data && <PluginDialog teamId={team.id} configs={configs.data} reload={reload} onClose={() => setDialog(null)} />}
    </>
  );
}

/** A state as a word. What waits is marked by the sidebar's amber dot, not here: one screen carries at most two (docs/design.md). */
function StateBadge({ state }: { state: Submission['state'] }) {
  const t = useTranslations('team.sharing.states');
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', state === 'pending' || state === 'published' ? 'bg-secondary text-foreground' : 'bg-secondary text-muted-foreground')}>
      {t(state)}
    </span>
  );
}

function SubmissionRow({
  row,
  team,
  current,
  names,
  reload,
  revise,
}: {
  row: Submission;
  team: Team;
  current: TeamConfig | null;
  names: ReadonlyMap<string, string>;
  reload: Reload;
  revise: (target: Target) => void;
}) {
  const t = useTranslations('team.sharing');
  const tk = useTranslations('team.overview.kind');
  const format = useFormatter();
  const now = useNow();
  const { session } = useSession();
  const admin = team.role === 'admin';
  const mine = row.authorId === session.user?.id;
  const who = (id: string) => team.members.find((m) => m.userId === id)?.email ?? t('formerMember');
  const { pending, run } = useMutation(reload);
  const [decision, setDecision] = useState<'approve' | 'reject' | 'withdraw' | null>(null);
  const Icon = row.proposal.kind === 'plugin' ? Puzzle : Layers;

  return (
    <li className="border-t first:border-t-0">
      <details className="group">
        <summary className="flex list-none items-start gap-3 px-4 py-3.5 hover:bg-accent [&::-webkit-details-marker]:hidden">
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-medium">{row.proposal.name}</span>
              <span className="text-xs text-muted-foreground">{tk(row.proposal.kind)}</span>
              {/* A new resource has an id from the start; only a base version says it updates one. */}
              <span className="text-xs text-muted-foreground">{row.baseVersion > 0 ? t('update', { version: row.baseVersion }) : t('new')}</span>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {who(row.authorId)} · <time dateTime={row.createdAt}>{format.relativeTime(new Date(row.createdAt), now)}</time>
              {row.note && ` · ${row.note}`}
            </span>
          </span>
          <StateBadge state={row.state} />
        </summary>

        <div className="flex flex-col gap-4 border-t bg-muted/40 px-4 py-4 sm:pl-15">
          {row.note && <p className="text-sm whitespace-pre-wrap">{row.note}</p>}
          <ConfigDiff
            before={current ? { name: current.name, data: current.data } : null}
            after={{ name: row.proposal.name, data: row.proposal.data as Record<string, unknown> }}
            names={names}
            beforeLabel={current ? t('current', { version: current.version }) : t('notYet')}
            afterLabel={t('proposed')}
          />
          {(row.reviewerId || row.reason) && (
            <p className="text-sm text-muted-foreground">
              {row.reviewerId && t('decidedBy', { name: who(row.reviewerId), at: row.decidedAt ? format.dateTime(new Date(row.decidedAt), { dateStyle: 'medium', timeStyle: 'short' }) : '' })}
              {row.reason && <span className="mt-1 block whitespace-pre-wrap text-foreground">{row.reason}</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {row.state === 'pending' && admin && (
              <>
                <Button size="sm" disabled={pending} onClick={() => setDecision('approve')}>
                  {t('approve')}
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setDecision('reject')}>
                  {t('reject')}
                </Button>
              </>
            )}
            {row.state === 'pending' && mine && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setDecision('withdraw')}>
                {t('withdraw')}
              </Button>
            )}
            {row.state === 'draft' && mine && (
              <Button size="sm" disabled={pending} onClick={() => void run(() => api(`teams/${team.id}/submissions/${row.id}/submit`, { body: { revision: row.revision } }), t('submitted'))}>
                {t('submit')}
              </Button>
            )}
            {row.state !== 'pending' && mine && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  revise(
                    row.state === 'draft'
                      ? { id: row.id, revision: row.revision, configId: current?.id, baseVersion: row.baseVersion }
                      : { configId: current?.id, baseVersion: current?.version ?? 0 },
                  )
                }
              >
                {t('revise')}
              </Button>
            )}
          </div>
        </div>
      </details>
      {decision && <DecisionDialog teamId={team.id} row={row} action={decision} reload={reload} onClose={() => setDecision(null)} />}
    </li>
  );
}

/** Approve, reject (a reason is required) or withdraw, against the revision the reader saw. */
function DecisionDialog({ teamId, row, action, reload, onClose }: { teamId: string; row: Submission; action: 'approve' | 'reject' | 'withdraw'; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.sharing');
  const { pending, run } = useMutation(reload);
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${action}Title`, { name: row.proposal.name })}</DialogTitle>
          <DialogDescription>{t(`${action}Hint`)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="decision-reason">{t(action === 'reject' ? 'reasonRequired' : 'reasonOptional')}</Label>
          <Textarea id="decision-reason" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={action === 'approve' ? 'default' : 'outline'}
            disabled={pending || (action === 'reject' && !reason.trim())}
            onClick={async () => {
              if (await run(() => api(`teams/${teamId}/submissions/${row.id}/${action}`, { body: { revision: row.revision, reason } }), t('done'))) onClose();
            }}
          >
            {t(action)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A file picked by click or dropped on the box. */
function DropZone({ accept, label, hint, pick, children }: { accept: string; label: string; hint: string; pick: (file: File) => void; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) pick(file);
      }}
      className={cn('flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center text-sm', over ? 'border-ring bg-accent' : 'hover:bg-accent')}
    >
      <Package className="size-5 text-muted-foreground" aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      {children}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Submit a preset from a file, or revise one: the name, the role prompt and a note, then off to review. */
function PresetDialog({
  teamId,
  initial,
  initialNote,
  target,
  reload,
  onClose,
}: {
  teamId: string;
  initial?: Proposal;
  initialNote?: string;
  target?: Target;
  reload: Reload;
  onClose: () => void;
}) {
  const t = useTranslations('team.sharing');
  const { pending, run } = useMutation(reload);
  const [proposal, setProposal] = useState<Proposal | null>(initial ?? null);
  const [note, setNote] = useState(initialNote ?? '');
  const [invalid, setInvalid] = useState(false);
  const data = (proposal?.data ?? {}) as Record<string, unknown>;

  async function read(file: File) {
    try {
      if (file.size > 65536) throw Error('too large');
      const value = JSON.parse(await file.text()) as Proposal;
      if (value.kind !== 'preset' || typeof value.name !== 'string' || !value.data) throw Error('not a preset');
      setProposal(value);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target ? t('reviseTitle') : t('submitPreset')}</DialogTitle>
          <DialogDescription>{t('presetHint')}</DialogDescription>
        </DialogHeader>
        {!proposal ? (
          <DropZone accept=".json,application/json" label={t('dropPreset')} hint={t('presetLimit')} pick={(file) => void read(file)} />
        ) : (
          <div className="flex flex-col gap-3">
            <Label htmlFor="proposal-name">{t('resourceName')}</Label>
            <Input id="proposal-name" value={proposal.name} maxLength={120} onChange={(e) => setProposal({ ...proposal, name: e.target.value })} />
            {proposal.kind === 'preset' && (
              <>
                <Label htmlFor="proposal-prompt">{t('prompt')}</Label>
                <Textarea
                  id="proposal-prompt"
                  className="min-h-32 font-mono text-xs"
                  value={String(data.systemPrompt ?? '')}
                  onChange={(e) => setProposal({ ...proposal, data: { ...proposal.data, systemPrompt: e.target.value } as Proposal['data'] })}
                />
              </>
            )}
            <Label htmlFor="proposal-note">{t('note')}</Label>
            <Textarea id="proposal-note" maxLength={2000} value={note} placeholder={t('notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidFile')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !proposal || !proposal.name.trim()}
            onClick={async () => {
              if (!proposal) return;
              const ok = await run(async () => {
                const draft = await api<Submission>(target?.id ? `teams/${teamId}/submissions/${target.id}` : `teams/${teamId}/submissions`, {
                  method: target?.id ? 'PUT' : 'POST',
                  body: { config: proposal, configId: target?.configId, baseVersion: target?.baseVersion ?? 0, revision: target?.revision, note },
                });
                await api(`teams/${teamId}/submissions/${draft.id}/submit`, { body: { revision: draft.revision } });
              }, t('submitted'));
              if (ok) onClose();
            }}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Upload a plugin package for review: the archive is inspected in the browser
 * first (package, version, SHA-256, every file it holds), then uploaded and
 * checked against that digest, as a new team plugin or an update of one.
 */
function PluginDialog({ teamId, configs, reload, onClose }: { teamId: string; configs: TeamConfig[]; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.sharing');
  const { pending, run } = useMutation(reload);
  const [plugin, setPlugin] = useState<{ file: File; preview: PluginPreview } | null>(null);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const plugins = configs.filter((c) => c.kind === 'plugin');

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('uploadPlugin')}</DialogTitle>
          <DialogDescription>{t('uploadLimits')}</DialogDescription>
        </DialogHeader>
        {!plugin ? (
          <DropZone
            accept=".tgz,.gz"
            label={t('dropPlugin')}
            hint={t('pluginLimit')}
            pick={async (file) => {
              try {
                setPlugin({ file, preview: await inspectPluginArchive(file) });
                setInvalid(false);
              } catch {
                setInvalid(true);
              }
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {plugin.preview.package} <span className="text-muted-foreground">@ {plugin.preview.version}</span>
              </p>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">SHA-256 {plugin.preview.sha256}</p>
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground hover:text-foreground">{t('includedFiles', { count: plugin.preview.files.length })}</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs">{plugin.preview.files.join('\n')}</pre>
              </details>
            </div>
            <Label htmlFor="plugin-target">{t('target')}</Label>
            <Select
              id="plugin-target"
              label={t('target')}
              value={target}
              options={[{ value: '', label: t('newPlugin') }, ...plugins.map((c) => ({ value: c.id, label: `${c.name} · v${c.version}` }))]}
              change={setTarget}
              className="w-full"
            />
            <Label htmlFor="plugin-note">{t('note')}</Label>
            <Textarea id="plugin-note" maxLength={2000} value={note} placeholder={t('notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidArchive')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !plugin}
            onClick={async () => {
              if (!plugin) return;
              const existing = plugins.find((c) => c.id === target);
              const ok = await run(async () => {
                const artifact = await uploadArtifact<Schemas['ResourceArtifact']>(teamId, plugin.file);
                if (artifact.sha256 !== plugin.preview.sha256) throw Error('Artifact mismatch');
                const config = {
                  kind: 'plugin',
                  name: existing?.name ?? plugin.preview.package,
                  data: { package: artifact.package, version: artifact.version, artifactId: artifact.id, sha256: artifact.sha256, description: note },
                };
                const draft = await api<Submission>(`teams/${teamId}/submissions`, { body: { config, configId: existing?.id, baseVersion: existing?.version ?? 0, note } });
                await api(`teams/${teamId}/submissions/${draft.id}/submit`, { body: { revision: draft.revision } });
              }, t('submitted'));
              if (ok) onClose();
            }}
          >
            {t('uploadSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
