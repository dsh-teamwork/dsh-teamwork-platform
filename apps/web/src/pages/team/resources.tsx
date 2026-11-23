/**
 * The team toolbox (`/teams/{teamId}/resources`), under Work for everyone
 * (ADR 0043): the team's presets and pinned plugins as one read-only
 * catalogue, each as it shows up in DSH, with a line leading to connecting DSH
 * while the reader has not. Its models, with their rates, are on Models and
 * usage (./my-usage.tsx), beside what they cost. Changing any of it is Team
 * assets's, the admin's alone. Each row opens its details in a dialog, from
 * which a member suggests a change to a preset. A member submits a preset or a
 * plugin package here, for review, and follows what they sent in My
 * submissions, a dialog opened from the header once there is anything in it
 * (and by `?submissions`, where Home links to one waiting for review).
 */

import { ArrowRight, ChevronRight, FileJson, FileUp, Inbox, Laptop, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PresetAvatar } from '@/components/preset-avatar';
import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Schemas, TeamConfig } from '@/lib/api';
import { diffResource } from '@/lib/config-diff';
import { useApi } from '@/lib/use-api';

import { useOwnDsh } from './connect-dsh';
import { useTeam } from './layout';
import { blankDraft, presetDraft, PresetEditor, type Draft } from './presets';
import { MySubmissions, PluginDialog, PresetDialog } from './sharing';

type Preset = Extract<TeamConfig, { kind: 'preset' }>;
type Plugin = Extract<TeamConfig, { kind: 'plugin' }>;

export function TeamResourcesPage() {
  const { team } = useTeam();
  const t = useTranslations('team.resources');
  const tn = useTranslations('team.nav');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  // The reader's own submissions waiting for review, on the button that opens them.
  const summary = useApi<Schemas['TeamSummary']>(`teams/${team.id}/summary`);
  // Whether the reader has sent anything at all: the button shows only then.
  const mine = useApi<Schemas['ResourceSubmission'][]>(`teams/${team.id}/submissions?mine=true`);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Preset | Plugin | null>(null);
  // An admin changes presets in Team assets; a member submits here.
  const member = team.role === 'member';
  const dsh = useOwnDsh();
  const [proposing, setProposing] = useState<{ draft: Draft; preset?: Preset } | null>(null);
  // A file to send: a plugin package, or a preset exported from DSH.
  const [uploading, setUploading] = useState<'plugin' | 'preset' | null>(null);
  const base = `/teams/${team.id}`;
  const waiting = summary.data?.pendingReviews ?? 0;
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  const all = configs.data;
  const of = <K extends TeamConfig['kind']>(kind: K) => all.filter((c): c is Extract<TeamConfig, { kind: K }> => c.kind === kind);
  const names = new Map(all.map((c) => [c.id, c.name]));
  const reloadMine = () => Promise.all([configs.reload(), summary.reload(), mine.reload()]);
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
      {waiting > 0 && <span className="rounded-full bg-secondary px-1.5 text-xs font-medium tabular-nums">{t('waiting', { count: waiting })}</span>}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={tn('resources')}
        description={t('description')}
        action={
          member ? (
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
                {t('propose')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sent}
              <Button asChild variant="outline">
                <Link to={`${base}/presets`}>{t('manage')}</Link>
              </Button>
            </div>
          )
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
      <Group title={t('presets')} hint={t('presetsHint')} empty={t('noPresets')}>
        {of('preset').map((p) => (
          <Row key={p.id} name={p.name} detail={p.data.description} icon={<PresetAvatar avatar={p.data.avatar} name={p.name} />} onOpen={() => setOpen(p)} />
        ))}
      </Group>
      <Group title={t('plugins')} hint={t('pluginsHint')} empty={t('noPlugins')}>
        {of('plugin').map((p) => (
          <Row key={p.id} name={p.name} detail={p.data.description || `${p.data.package}@${p.data.version}`} mono={!p.data.description} onOpen={() => setOpen(p)} />
        ))}
      </Group>
      {open && (
        <Details
          config={open}
          names={names}
          onClose={() => setOpen(null)}
          action={
            member &&
            open.kind === 'preset' && (
              <Button
                onClick={() => {
                  setProposing({ draft: presetDraft(open), preset: open });
                  setOpen(null);
                }}
              >
                {t('proposeChange')}
              </Button>
            )
          }
        />
      )}
      {submissions && <MySubmissions reload={reloadMine} onClose={() => showSubmissions(false)} />}
      {proposing && (
        <PresetEditor
          teamId={team.id}
          submitForReview
          reload={reloadMine}
          initial={proposing.draft}
          preset={proposing.preset}
          models={of('model')}
          plugins={of('plugin')}
          onClose={() => setProposing(null)}
        />
      )}
      {uploading === 'plugin' && <PluginDialog teamId={team.id} configs={all} reload={reloadMine} onClose={() => setUploading(null)} />}
      {uploading === 'preset' && <PresetDialog teamId={team.id} reload={reloadMine} onClose={() => setUploading(null)} />}
    </>
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
function Row({ name, detail, mono = false, icon, onOpen }: { name: string; detail?: string; mono?: boolean; icon?: ReactNode; onOpen: () => void }) {
  return (
    <li className="border-t first:border-t-0">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{name}</span>
          {detail && <span className={mono ? 'font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]' : 'line-clamp-2 text-xs text-muted-foreground'}>{detail}</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

/** What a member has no use for: the mark drawn beside the name, and where the package's archive is kept. */
const HIDDEN = new Set(['name', 'avatar', 'artifactId', 'sha256']);

/** A preset or plugin in full, each field as the review shows it (lib/config-diff.ts reads the values). */
function Details({ config, names, action, onClose }: { config: Preset | Plugin; names: ReadonlyMap<string, string>; action?: ReactNode; onClose: () => void }) {
  const t = useTranslations('team.resources');
  const td = useTranslations('team.diff');
  const fields = diffResource(null, { name: config.name, data: config.data }, names).filter((f) => !HIDDEN.has(f.key));
  const label = (key: string) => (td.has(`fields.${key}`) ? td(`fields.${key}`) : key);
  const say = (value: string) => (value === 'true' ? td('yes') : value === 'false' ? td('no') : value);
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {config.kind === 'preset' && <PresetAvatar avatar={config.data.avatar} name={config.name} />}
            <span className="min-w-0 flex-1">{config.name}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">v{config.version}</span>
          </DialogTitle>
          <DialogDescription>{t(config.kind === 'preset' ? 'presetsHint' : 'pluginsHint')}</DialogDescription>
        </DialogHeader>
        <dl className="flex max-h-[60vh] flex-col overflow-y-auto rounded-lg border text-sm">
          {fields.map((f) => (
            <div key={f.key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-t px-4 py-2.5 first:border-t-0">
              <dt className="text-muted-foreground">{label(f.key)}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {f.long ? <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs whitespace-pre-wrap">{f.after}</pre> : say(f.after)}
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
          {action}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
