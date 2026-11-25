/** Read-only submission history and the team asset upload dialogs. */

import { ChevronRight, Layers, Package, Puzzle } from 'lucide-react';
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
import { api, uploadPackage, type Schemas, type Team, type TeamConfig } from '@/lib/api';
import { inspectPluginArchive, type PluginPreview } from '@/lib/plugin-archive';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type Submission = Schemas['ResourceSubmission'];
type Proposal = Schemas['ConfigInput'];
type Reload = () => Promise<unknown>;
const PAGE = 50;

/** The team's legacy submission history, under Team assets. */
export function TeamSharingPage() {
  const { team } = useTeam();
  const t = useTranslations('team.sharing');
  const tn = useTranslations('team.nav');
  return (
    <>
      <PageHeader title={tn('sharing')} description={t('adminHint')} />
      <Submissions key={team.id} team={team} review />
    </>
  );
}

/** The reader's own submissions, in a dialog over the Team toolbox; `reload` reads again what the toolbox shows of them. */
export function MySubmissions({ onClose }: { onClose: () => void }) {
  const { team } = useTeam();
  const t = useTranslations('team.sharing');
  const tn = useTranslations('team.nav');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tn('submissions')}</DialogTitle>
          <DialogDescription>{t('memberHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <Submissions team={team} review={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Submissions({ team, review }: { team: Team; review: boolean }) {
  const t = useTranslations('team.sharing');
  const word = useTeamError();
  const [offset, setOffset] = useState(0);
  const rows = useApi<Submission[]>(`teams/${team.id}/submissions?offset=${offset}${review ? '' : '&mine=true'}`);
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);

  const failed = (!rows.data && rows.error) || (!configs.data && configs.error);
  if (failed) return <Failure message={word(failed)} />;
  const names = new Map((configs.data ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      {!rows.data || !configs.data ? null : rows.data.length === 0 ? (
        <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border">
          {rows.data.map((row) => (
            <SubmissionRow
              key={row.id}
              row={row}
              team={team}
              current={configs.data?.find((c) => c.id === row.configId) ?? null}
              names={names}
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

    </>
  );
}

/** A state as a word. What waits is marked by the sidebar's amber dot, not here: the badge reflects the historical state. */
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
}: {
  row: Submission;
  team: Team;
  current: TeamConfig | null;
  names: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('team.sharing');
  const tk = useTranslations('team.overview.kind');
  const format = useFormatter();
  const now = useNow();
  const who = (id: string) => team.members.find((m) => m.userId === id)?.email ?? t('formerMember');
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
        </div>
      </details>
    </li>
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

/** Import a preset from a JSON file and publish it to the current team. */
export function PresetDialog({ teamId, target, reload, onClose }: { teamId: string; target?: Extract<TeamConfig, { kind: 'preset' }>; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.sharing');
  const tr = useTranslations('team.resources');
  const { pending, run } = useMutation(reload);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [invalid, setInvalid] = useState(false);
  const data = (proposal?.data ?? {}) as Record<string, unknown>;

  async function read(file: File) {
    try {
      if (file.size > 65536) throw Error('too large');
      const value = JSON.parse(await file.text()) as Proposal;
      if (value.kind !== 'preset' || typeof value.name !== 'string' || !value.data) throw Error('not a preset');
      setProposal(target ? { ...value, name: target.name } : value);
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr(target ? 'uploadVersion' : 'importPreset')}</DialogTitle>
          <DialogDescription>{tr('publicationHint')}</DialogDescription>
          {target && <p className="text-sm font-medium">{target.name} · v{target.version}</p>}
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
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidFile')}
          </p>
        )}
        <DialogFooter>
          {proposal && <Button variant="outline" disabled={pending} onClick={() => { setProposal(null); setInvalid(false); }}>{tr('replaceFile')}</Button>}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !proposal || !proposal.name.trim()}
            onClick={async () => {
              if (!proposal) return;
              const ok = await run(() => api(target ? `teams/${teamId}/configs/${target.id}` : `teams/${teamId}/configs`, { method: target ? 'PATCH' : 'POST', body: { ...proposal, memberAsset: true, ...(target ? { version: target.version } : {}) } }), tr('published'));
              if (ok) onClose();
            }}
          >
            {tr('publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inspect, upload and publish a plugin package to the current team. */
export function PluginDialog({ teamId, configs, initialTarget, reload, onClose }: { teamId: string; configs: TeamConfig[]; initialTarget?: string; reload: Reload; onClose: () => void }) {
  const t = useTranslations('team.sharing');
  const tr = useTranslations('team.resources');
  const { pending, run } = useMutation(reload);
  const [plugin, setPlugin] = useState<{ file: File; preview: PluginPreview } | null>(null);
  const [target, setTarget] = useState(initialTarget ?? '');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const plugins = configs.filter((c) => c.kind === 'plugin');

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialTarget ? tr('uploadVersion') : t('uploadPlugin')}</DialogTitle>
          <DialogDescription>{tr('publicationHint')}</DialogDescription>
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
            <Label htmlFor="plugin-note">{tr('assetDescription')}</Label>
            <Textarea id="plugin-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t('invalidArchive')}
          </p>
        )}
        <DialogFooter>
          {plugin && <Button variant="outline" disabled={pending} onClick={() => { setPlugin(null); setInvalid(false); }}>{tr('replaceFile')}</Button>}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={pending || !plugin}
            onClick={async () => {
              if (!plugin) return;
              const existing = plugins.find((c) => c.id === target);
              const ok = await run(async () => {
                const pkg = await uploadPackage<Schemas['PluginPackage']>(teamId, plugin.file);
                if (pkg.sha256 !== plugin.preview.sha256) throw Error('Package mismatch');
                const config = {
                  kind: 'plugin',
                  name: existing?.name ?? plugin.preview.package,
                  data: { package: pkg.package, version: pkg.version, packageId: pkg.id, sha256: pkg.sha256, description: note },
                };
                return api(existing ? `teams/${teamId}/configs/${existing.id}` : `teams/${teamId}/configs`, {
                  method: existing ? 'PATCH' : 'POST',
                  body: { ...config, memberAsset: true, ...(existing ? { version: existing.version } : {}) },
                });
              }, tr('published'));
              if (ok) onClose();
            }}
          >
            {tr('publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
