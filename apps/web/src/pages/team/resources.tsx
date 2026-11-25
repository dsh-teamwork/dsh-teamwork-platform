/** The team catalog, personal uploads and choices that sync to DSH. */

import { ArrowRight, ChevronRight, FileJson, FileUp, Inbox, Laptop, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PresetAvatar } from '@/components/preset-avatar';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, type Schemas, type TeamConfig } from '@/lib/api';
import { diffResource } from '@/lib/config-diff';
import { useApi } from '@/lib/use-api';

import { useOwnDsh } from './connect-dsh';
import { useTeam } from './layout';
import { blankDraft, presetDraft, PresetEditor, type Draft } from './presets';
import { MySubmissions, PluginDialog, PresetDialog } from './sharing';

type Preset = Extract<TeamConfig, { kind: 'preset' }>;
type Plugin = Extract<TeamConfig, { kind: 'plugin' }>;

export function TeamResourcesPage() {
  const { team, me } = useTeam();
  const t = useTranslations('team.resources');
  const tn = useTranslations('team.nav');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const choices = useApi<AssetChoices>(`teams/${team.id}/asset-choices`);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'installed'>('all');
  // Whether the reader has sent anything at all: the button shows only then.
  const mine = useApi<Schemas['ResourceSubmission'][]>(`teams/${team.id}/submissions?mine=true`);
  const [params, setParams] = useSearchParams();
  const setOpen = (asset: Preset | Plugin | null) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (asset) next.set('asset', asset.id);
    else next.delete('asset');
    return next;
  }, { replace: true });
  const admin = team.role === 'admin';
  const dsh = useOwnDsh();
  const [proposing, setProposing] = useState<{ draft: Draft; preset?: Preset } | null>(null);
  const [uploadTarget, setUploadTarget] = useState<Preset | Plugin>();
  const [uploading, setUploading] = useState<'plugin' | 'preset' | null>(null);
  const base = `/teams/${team.id}`;
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  if (!choices.data) return choices.error ? <Failure message={word(choices.error)} /> : null;
  const all = configs.data;
  const shown = scope === 'installed' ? [...all, ...choices.data.archived] : all;
  const open = [...all, ...choices.data.archived].find((asset): asset is Preset | Plugin => asset.id === params.get('asset') && asset.kind !== 'model');
  const of = <K extends TeamConfig['kind']>(kind: K) => all.filter((c): c is Extract<TeamConfig, { kind: K }> => c.kind === kind);
  const names = new Map(all.map((c) => [c.id, c.name]));
  const reloadMine = () => Promise.all([configs.reload(), choices.reload(), mine.reload()]);
  const author = (asset: TeamConfig) => {
    const member = team.members.find((m) => m.userId === asset.assetOwnerId);
    if (member?.name && team.members.some((other) => other.userId !== member.userId && other.name === member.name)) {
      return `${member.name} (${member.email || member.userId})`;
    }
    return member?.name || member?.email || asset.assetOwnerId;
  };
  const matches = (asset: TeamConfig) => {
    const personal = choices.data?.personal[asset.id];
    const defaultChoice = choices.data?.defaults[asset.id];
    if (scope === 'mine' && asset.assetOwnerId !== me) return false;
    if (scope === 'installed' && asset.assetOwnerId && !personal?.version &&
      (personal?.disabled || !defaultChoice?.version) && !asset.assetArchived) return false;
    return `${asset.name} ${defaultChoice?.name ?? ''} ${author(asset) ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  };
  const rowName = (asset: TeamConfig) => [
    choices.data?.defaults[asset.id]?.name || asset.name,
    author(asset),
    asset.assetArchived && t('archivedLabel'),
  ].filter(Boolean).join(' · ');
  const rowStatus = (asset: TeamConfig) => {
    const personal = choices.data?.personal[asset.id];
    const teamDefault = choices.data?.defaults[asset.id];
    return [
      personal?.version && t('selectedVersion', { version: personal.version }),
      teamDefault?.version && t(personal?.disabled ? 'defaultDisabled' : 'defaultVersion', { version: teamDefault.version }),
    ].filter(Boolean).join(' · ');
  };
  const empty = (kind: 'preset' | 'plugin') => query.trim() ? t('noResults') :
    scope === 'mine' ? t('noOwnAssets') : scope === 'installed' ? t('noInstalls') : t(kind === 'preset' ? 'noPresets' : 'noPlugins');
  const closeUpload = () => { setUploading(null); setUploadTarget(undefined); };
  const submissions = params.has('submissions');
  const showSubmissions = (show: boolean) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (show) next.set('submissions', '');
      else next.delete('submissions');
      return next;
    }, { replace: true });
  const sent = (mine.data?.length ?? 0) > 0 && (
    <Button variant="outline" onClick={() => showSubmissions(true)}>
      <Inbox />
      {tn('submissions')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={tn('resources')}
        description={t('description')}
        action={
          <div className="flex flex-wrap gap-2">
            {sent}
            <Button variant="outline" onClick={() => setUploading('plugin')}>
              <Upload />
              {t('uploadPlugin')}
            </Button>
            <Button variant="outline" onClick={() => setUploading('preset')}>
              <FileUp />
              {t('importPreset')}
            </Button>
            <Button onClick={() => setProposing({ draft: blankDraft(of('model')) })}>
              <FileJson />
              {t('createPreset')}
            </Button>
            {admin && <Button asChild variant="outline"><Link to={`${base}/presets`}>{t('manage')}</Link></Button>}
          </div>
        }
      />
      {/* Until one of the reader's computers signs in, none of this reaches them: say where it shows up, and how. */}
      {dsh.hosts && !dsh.computer && (
        <Link to={`${base}/home`} className="flex items-center gap-3 rounded-lg border bg-muted px-4 py-3 text-sm hover:bg-accent">
          <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">{t('connect')}</span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" aria-label={t('search')} placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label={t('catalogScope')} className="flex flex-wrap gap-2">
          {(['all', 'mine', 'installed'] as const).map((item) => (
            <Button key={item} variant={scope === item ? 'secondary' : 'outline'} aria-pressed={scope === item} onClick={() => setScope(item)}>
              {t(item === 'all' ? 'allAssets' : item === 'mine' ? 'myAssets' : 'installed')}
            </Button>
          ))}
        </div>
      </div>
      <Group title={t('presets')} hint={t('presetsHint')} empty={empty('preset')}>
        {shown.filter((asset): asset is Preset => asset.kind === 'preset' && matches(asset)).map((p) => (
          <Row key={p.id} name={rowName(p)} status={rowStatus(p)} detail={p.data.description} icon={<PresetAvatar avatar={p.data.avatar} name={p.name} />} onOpen={() => setOpen(p)} />
        ))}
      </Group>
      <Group title={t('plugins')} hint={t('pluginsHint')} empty={empty('plugin')}>
        {shown.filter((asset): asset is Plugin => asset.kind === 'plugin' && matches(asset)).map((p) => (
          <Row key={p.id} name={rowName(p)} status={rowStatus(p)} detail={p.data.description || `${p.data.package}@${p.data.version}`} mono={!p.data.description} onOpen={() => setOpen(p)} />
        ))}
      </Group>
      {open && (
        <AssetDetails
          key={open.id}
          asset={open}
          names={names}
          teamId={team.id}
          admin={admin}
          owner={open.assetOwnerId === me}
          choices={choices.data}
          reload={reloadMine}
          close={() => setOpen(null)}
          upload={() => {
            setUploadTarget(open);
            setUploading(open.kind);
            setOpen(null);
          }}
          edit={open.kind === 'preset' ? () => {
            setProposing({ draft: presetDraft(open), preset: open });
            setOpen(null);
          } : undefined}
        />
      )}
      {submissions && <MySubmissions onClose={() => showSubmissions(false)} />}
      {proposing && (
        <PresetEditor
          teamId={team.id}
          memberAsset
          reload={reloadMine}
          initial={proposing.draft}
          preset={proposing.preset}
          models={of('model')}
          plugins={of('plugin')}
          onClose={() => setProposing(null)}
        />
      )}
      {uploading === 'plugin' && <PluginDialog teamId={team.id} configs={all.filter((asset) => asset.assetOwnerId === me)} initialTarget={uploadTarget?.id} reload={reloadMine} onClose={closeUpload} />}
      {uploading === 'preset' && <PresetDialog teamId={team.id} target={uploadTarget?.kind === 'preset' ? uploadTarget : undefined} reload={reloadMine} onClose={closeUpload} />}
    </>
  );
}

type AssetChoice = Schemas['AssetChoice'];
type AssetChoices = Omit<Schemas['AssetChoices'], 'archived'> & { archived: TeamConfig[] };

function AssetDetails({ asset, names, teamId, admin, owner, choices, reload, close, edit, upload }: {
  asset: Preset | Plugin;
  names: ReadonlyMap<string, string>;
  teamId: string;
  admin: boolean;
  owner: boolean;
  choices: AssetChoices;
  reload: () => Promise<unknown>;
  close: () => void;
  edit?: () => void;
  upload: () => void;
}) {
  const t = useTranslations('team.resources');
  const { pending, run } = useMutation(reload);
  const path = `teams/${teamId}`;
  const personal = choices.personal[asset.id];
  const teamDefault = choices.defaults[asset.id];
  const effective = personal?.version || (!personal?.disabled && teamDefault?.version) || undefined;
  const [version, setVersion] = useState(effective ?? asset.version);
  const [name, setName] = useState(teamDefault?.name ?? '');
  const [confirm, setConfirm] = useState<'archive' | 'removeDefault'>();
  const history = useApi<Schemas['ConfigRevision'][]>(asset.assetOwnerId ? `${path}/history?configId=${asset.id}` : null);
  const versions = [...new Set([asset.version, effective, teamDefault?.version, ...(teamDefault?.adoptedVersions ?? []),
    ...(history.data ?? []).map((r) => r.version)].filter((value): value is number => !!value))].sort((a, b) => b - a);
  const revision = history.data?.find((r) => r.version === version && r.kind === asset.kind);
  const preview = version === asset.version ? asset : revision ? { ...asset, version, name: revision.name, data: revision.data } as typeof asset : undefined;
  const choice = (scope: 'asset-choices' | 'asset-defaults', body: Partial<AssetChoice>, message = t('selectionSaved')) =>
    run(() => api(`${path}/${scope}/${asset.id}`, { method: 'PUT', body: scope === 'asset-defaults' ? { revision: teamDefault?.revision ?? 0, ...body } : body }), message);
  const status = [
    effective ? t(asset.kind === 'plugin' ? 'selectedVersion' : 'usingVersion', { version: effective }) : t('noSelection'),
    teamDefault?.version ? t('defaultVersion', { version: teamDefault.version }) : t('noDefault'),
    t('latestVersion', { version: asset.version }),
  ];
  const canSetDefault = !!preview && (!asset.assetArchived || teamDefault?.adoptedVersions?.includes(version));

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && close()}>
      <DialogContent className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {asset.kind === 'preset' && <PresetAvatar avatar={asset.data.avatar} name={asset.name} />}
            <span className="min-w-0 break-words">{teamDefault?.name || asset.name}</span>
          </DialogTitle>
          {teamDefault?.name && teamDefault.name !== asset.name && <p className="text-xs text-muted-foreground">{t('originalName', { name: asset.name })}</p>}
          <DialogDescription>{asset.kind === 'preset' ? t('presetsHint') : t('pluginSelectionHint')}</DialogDescription>
        </DialogHeader>
        {asset.assetOwnerId && <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="asset-version">{t('previewVersion')}</Label>
            <Select id="asset-version" label={t('previewVersion')} value={String(version)} options={versions.map((value) => ({ value: String(value), label: `v${value}` }))} change={(value) => setVersion(Number(value))} />
          </div>
          <section aria-label={t('myUse')} className="space-y-3">
            <h3 className="text-sm font-semibold">{t('myUse')}</h3>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{status.map((line) => <span key={line}>{line}</span>)}</p>
            <div className="flex flex-wrap items-center gap-2">
              {!asset.assetArchived && <Button disabled={pending || !preview || personal?.version === version} onClick={() => void choice('asset-choices', { version, disabled: personal?.disabled ?? false }, asset.kind === 'plugin' ? t('pluginSelected') : t('selectionSaved'))}>
                {t(personal?.version === version ? 'selectedVersion' : 'selectVersion', { version })}
              </Button>}
            </div>
            {asset.kind === 'plugin' && effective && <a className="text-sm underline underline-offset-4" href="/docs/members" target="_blank" rel="noreferrer">{t('pluginInstructions')}</a>}
            {(!!personal?.version || !!teamDefault?.version) && <details className="text-sm">
              <summary className="cursor-pointer">{t('personalOptions')}</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {!!personal?.version && <Button variant="outline" disabled={pending} onClick={() => void choice('asset-choices', { disabled: personal.disabled })}>{t('uninstall', { version: personal.version })}</Button>}
                {!!teamDefault?.version && <Button variant="outline" disabled={pending} onClick={() => void choice('asset-choices', { version: personal?.version ?? 0, disabled: !personal?.disabled })}>
                  {t(personal?.disabled ? 'enableDefault' : 'disableDefault', { version: teamDefault.version })}
                </Button>}
              </div>
            </details>}
          </section>
        </>}
        {preview ? <VersionPreview config={preview} names={names} /> : <p role="status" className="text-sm">{t(history.error || history.data ? 'previewUnavailable' : 'previewLoading')}</p>}
        {asset.assetOwnerId && admin && <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('manageDefault')}</summary>
          <div className="mt-3 flex flex-col items-start gap-2">
            <Label htmlFor="asset-default-name">{t('defaultName')}</Label>
            <Input id="asset-default-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="outline" disabled={pending || !canSetDefault} onClick={() => void choice('asset-defaults', { version, name })}>{t('setDefaultVersion', { version })}</Button>
            {!!teamDefault?.version && <Button variant="ghost" disabled={pending} onClick={() => setConfirm('removeDefault')}>{t('removeDefault')}</Button>}
          </div>
        </details>}
        {owner && !asset.assetArchived && <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('manageAsset')}</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={upload}>{t('uploadVersion')}</Button>
            {edit && <Button variant="outline" disabled={pending} onClick={edit}>{t('editAsset')}</Button>}
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm('archive')}>{t('archive')}</Button>
          </div>
        </details>}
        {confirm && <section aria-label={t(confirm)} className="space-y-2 rounded-lg border p-3 text-sm">
          <p>{t(confirm === 'archive' ? 'archiveImpact' : 'withdrawImpact')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(undefined)}>{t('cancelAction')}</Button>
            <Button variant="destructive" disabled={pending} onClick={async () => {
              if (confirm === 'archive') {
                if (await run(() => api(`${path}/configs/${asset.id}`, { method: 'DELETE' }), t('archived'))) close();
              } else if (await choice('asset-defaults', {})) setConfirm(undefined);
            }}>{t(confirm === 'archive' ? 'confirmArchive' : 'removeDefault')}</Button>
          </div>
        </section>}
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, hint, empty, children }: { title: string; hint: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{hint}</p>
      </div>
      {children.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border">{children}</ul>
      )}
    </section>
  );
}

/** Lists are rows, not cards (docs/design.md, "Component rules"); each opens its details. */
function Row({ name, status, detail, mono = false, icon, onOpen }: { name: string; status?: string; detail?: string; mono?: boolean; icon?: ReactNode; onOpen: () => void }) {
  return (
    <li className="border-t first:border-t-0">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{name}</span>
          {status && <span className="text-xs font-medium text-muted-foreground">{status}</span>}
          {detail && <span className={mono ? 'font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]' : 'line-clamp-2 text-xs text-muted-foreground'}>{detail}</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

/** What a member has no use for: the mark drawn beside the name, and where the package's archive is kept. */
const HIDDEN = new Set(['name', 'avatar', 'packageId', 'sha256']);

/** A preset or plugin in full, each field as the review shows it (lib/config-diff.ts reads the values). */
function VersionPreview({ config, names }: { config: Preset | Plugin; names: ReadonlyMap<string, string> }) {
  const t = useTranslations('team.resources');
  const td = useTranslations('team.diff');
  const fields = diffResource(null, { name: config.name, data: config.data }, names).filter((f) => !HIDDEN.has(f.key));
  const label = (key: string) => (td.has(`fields.${key}`) ? td(`fields.${key}`) : key);
  const say = (value: string) => (value === 'true' ? td('yes') : value === 'false' ? td('no') : value);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t('versionPreview', { version: config.version })}</h3>
      <dl className="rounded-lg border text-sm">
        {fields.map((f) => (
          <div key={f.key} className="grid gap-1 border-t px-3 py-2 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">{label(f.key)}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              {f.long ? <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs whitespace-pre-wrap">{f.after}</pre> : say(f.after)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
