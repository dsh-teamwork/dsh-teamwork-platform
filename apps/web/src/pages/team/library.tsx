/**
 * Presets and plugins (`/teams/{teamId}/presets`, `?tab=plugins` for plugins): everything the team shares for DSH,
 * in one list for every member (docs/tech/team-assistant.md, "Member-owned assets"). A row says whether the item
 * is on the reader's DSH and adds, updates or removes it in one click; it opens its details beside the list. The
 * team's own items and the ones an admin recommends are on everyone's DSH until they remove them; a member's other
 * items are added by choice and follow their latest version unless pinned. An admin also recommends, updates a
 * recommendation, withdraws, and edits or deletes the team's own. What a member has reaches every computer they sign
 * in on, a new one included, except the ones they keep it off (`PUT …/asset-choices/{id}/hosts`).
 */

import { assetName, isBehind, isRecommended, reachOf, type AssetUse } from '@dsh-teamwork/shared';
import { ArrowRight, Check, History, Laptop, Plus, Puzzle, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PresetAvatar } from '@/components/preset-avatar';
import { PageHeader, twinOf } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type ConfigOf, type Schemas, type TeamConfig } from '@/lib/api';
import { diffResource } from '@/lib/config-diff';
import { PRESET_TEMPLATES, type PresetTemplate } from '@/lib/preset-templates';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { PluginDialog, PresetDialog } from './library-upload';
import { useOwnDsh } from './connect-dsh';
import { useTeam } from './layout';
import { NpmPluginDialog } from './plugins';
import { blankDraft, presetDraft, PresetEditor, Tools, type Draft } from './presets';

type Preset = ConfigOf<'preset'>;
type Plugin = ConfigOf<'plugin'>;
type Model = ConfigOf<'model'>;
type Item = Preset | Plugin;
type Choices = Omit<Schemas['AssetChoices'], 'archived'> & { archived: TeamConfig[] };
type Filter = 'all' | 'onDsh' | 'mine' | 'behind';
type Choose = (item: Item, body: Schemas['PersonalChoice'], message: string) => Promise<boolean>;
type Host = Schemas['RelayHost'];

export function TeamLibraryPage() {
  const { team, me } = useTeam();
  const t = useTranslations('team.library');
  const tp = useTranslations('team.presets');
  const tt = useTranslations('team.templates');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  const choices = useApi<Choices>(`teams/${team.id}/asset-choices`);
  const dsh = useOwnDsh();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ draft: Draft; preset?: Preset; template?: string; memberAsset: boolean } | null>(null);
  const [uploading, setUploading] = useState<{ kind: Item['kind']; target?: Item } | null>(null);
  const [npm, setNpm] = useState<Plugin | true | null>(null);
  const reload = () => Promise.all([configs.reload(), choices.reload()]);
  const { pending, run } = useMutation(reload);
  const setParam = (key: string, value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });

  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  if (!choices.data) return choices.error ? <Failure message={word(choices.error)} /> : null;
  const c = choices.data;
  const admin = team.role === 'admin';
  const kind: Item['kind'] = params.get('tab') === 'plugins' ? 'plugin' : 'preset';
  const live = configs.data;
  const items = [...live, ...c.archived.filter((a) => !live.some((l) => l.id === a.id))].filter((i): i is Item => i.kind !== 'model');
  const models = live.filter((i): i is Model => i.kind === 'model');
  const plugins = live.filter((i): i is Plugin => i.kind === 'plugin');
  const base = `/teams/${team.id}`;

  const author = (item: Item) => {
    if (!item.assetOwnerId) return t('team');
    if (item.assetOwnerId === me) return t('me');
    const member = team.members.find((m) => m.userId === item.assetOwnerId);
    return member?.name || member?.email || t('formerMember');
  };
  const choose: Choose = (item, body, message) => run(() => api(`teams/${team.id}/asset-choices/${item.id}`, { method: 'PUT', body }), message);
  const add = (item: Item) => choose(item, { mode: isRecommended(item, c) ? 'default' : 'latest' }, t('added'));
  const update = (item: Item) => choose(item, { mode: 'latest' }, t('updated'));

  const behind = items.filter((i) => i.kind === kind && isBehind(i, c)).length;
  const q = query.trim().toLocaleLowerCase();
  const shown = items.filter((item) => {
    if (item.kind !== kind) return false;
    const use = reachOf(item, c);
    // A withdrawn item stays in view for whoever still has it, its author and the admin.
    if (item.assetArchived && !use.on && item.assetOwnerId !== me && !admin) return false;
    if (filter === 'onDsh' && !use.on) return false;
    if (filter === 'mine' && item.assetOwnerId !== me) return false;
    if (filter === 'behind' && !isBehind(item, c)) return false;
    const description = item.kind === 'preset' ? item.data.description : item.data.description ?? '';
    return !q || `${assetName(item, c)} ${item.name} ${description} ${author(item)}`.toLocaleLowerCase().includes(q);
  });
  const recommended = shown.filter((i) => isRecommended(i, c));
  const others = shown.filter((i) => !isRecommended(i, c)).sort((a, b) => (c.users[b.id] ?? 0) - (c.users[a.id] ?? 0));
  const open = items.find((i) => i.id === params.get('item'));

  const fromTemplate = (template: PresetTemplate): Draft => ({
    ...blankDraft(models),
    name: tt(`${template.id}.name`),
    avatar: template.avatar,
    description: tt(`${template.id}.description`),
    outputDescription: tt(`${template.id}.deliverable`),
    // Raw: a persona is prose with line breaks, not a message with placeholders.
    systemPrompt: tt.raw(`${template.id}.systemPrompt`) as string,
    required: [...template.requiredTools],
    optional: [...template.optionalTools],
  });
  // What an admin creates here is the team's own; what a member creates is theirs to share.
  const create = (draft: Draft, template?: string) => setEditing({ draft, template, memberAsset: !admin });

  const row = (item: Item) => (
    <Row
      key={item.id}
      item={item}
      name={assetName(item, c)}
      author={author(item)}
      users={c.users[item.id] ?? 0}
      use={reachOf(item, c)}
      mine={item.assetOwnerId === me}
      behind={admin && isBehind(item, c)}
      hosts={dsh.hosts ?? []}
      off={c.off[item.id] ?? []}
      pending={pending}
      onOpen={() => setParam('item', item.id)}
      onAdd={() => void add(item)}
      onUpdate={() => void update(item)}
    />
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t(admin ? 'adminDescription' : 'description')}
        action={
          <div className="flex flex-wrap gap-2">
            {admin && (
              <Button asChild variant="ghost">
                <Link to={`${base}/history`}>
                  <History />
                  {t('history')}
                </Link>
              </Button>
            )}
            {kind === 'preset' ? (
              <>
                <Button variant="outline" onClick={() => setUploading({ kind: 'preset' })}>
                  <Upload />
                  {t('importPreset')}
                </Button>
                <Button onClick={() => create(blankDraft(models))}>
                  <Plus />
                  {t('newPreset')}
                </Button>
              </>
            ) : (
              <>
                {admin && (
                  <Button variant="outline" onClick={() => setNpm(true)}>
                    <Plus />
                    {t('addNpm')}
                  </Button>
                )}
                <Button onClick={() => setUploading({ kind: 'plugin' })}>
                  <Upload />
                  {t('uploadPlugin')}
                </Button>
              </>
            )}
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

      <div role="tablist" aria-label={t('title')} className="flex gap-5 border-b">
        {(['preset', 'plugin'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setFilter('all');
              setParam('tab', k === 'plugin' ? 'plugins' : null);
            }}
            className={cn('-mb-px border-b-2 py-2 text-sm', kind === k ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t(k === 'preset' ? 'presets' : 'plugins')}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" aria-label={t('search')} placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-2">
          {(['all', 'onDsh', 'mine', ...(admin ? (['behind'] as const) : [])] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'secondary' : 'outline'} aria-pressed={filter === f} onClick={() => setFilter(f)} className="rounded-full">
              {t(`filters.${f}`)}
              {/* Amber, as a dot: recommendations waiting on this admin (docs/design.md, "Component rules"). */}
              {f === 'behind' && behind > 0 && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('waiting', { count: behind })} />}
            </Button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">{t(q || filter !== 'all' ? 'noResults' : 'empty')}</p>
      ) : (
        <>
          {recommended.length > 0 && <Group title={t('groups.recommended')} hint={t('groups.recommendedHint')}>{recommended.map(row)}</Group>}
          {others.length > 0 && <Group title={t('groups.shared')} hint={t('groups.sharedHint')}>{others.map(row)}</Group>}
        </>
      )}

      {kind === 'preset' && filter === 'all' && !q && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold">{tp('templatesTitle')}</h2>
            <p className="text-sm text-muted-foreground">{tp('templatesHint')}</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PRESET_TEMPLATES.map((template) => (
              <li key={template.id} className="flex flex-col gap-3 rounded-lg border border-dashed bg-card p-4">
                <div className="flex items-start gap-3">
                  <PresetAvatar avatar={template.avatar} name={tt(`${template.id}.name`)} className="size-10" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{tt(`${template.id}.area`)}</span>
                    <h3 className="font-semibold">{tt(`${template.id}.name`)}</h3>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{tt(`${template.id}.persona`)}</p>
                <Tools required={template.requiredTools} optional={template.optionalTools} />
                <Button size="sm" variant="outline" className="mt-auto self-start" onClick={() => create(fromTemplate(template), tt(`${template.id}.name`))}>
                  <Plus />
                  {tp('useTemplate')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <Details
          key={open.id}
          item={open}
          teamId={team.id}
          choices={c}
          admin={admin}
          mine={open.assetOwnerId === me}
          author={author(open)}
          models={models}
          items={items}
          hosts={dsh.hosts ?? []}
          use={reachOf(open, c)}
          pending={pending}
          run={run}
          choose={choose}
          onAdd={() => void add(open)}
          onUpdate={() => void update(open)}
          close={() => setParam('item', null)}
          edit={() => {
            if (open.kind === 'preset') setEditing({ draft: presetDraft(open), preset: open, memberAsset: !!open.assetOwnerId });
            else if (open.assetOwnerId || open.data.packageId) setUploading({ kind: 'plugin', target: open });
            else setNpm(open);
          }}
          upload={() => setUploading({ kind: open.kind, target: open })}
        />
      )}
      {editing && (
        <PresetEditor
          teamId={team.id}
          memberAsset={editing.memberAsset}
          reload={reload}
          initial={editing.draft}
          preset={editing.preset}
          template={editing.template}
          models={models}
          plugins={plugins}
          onClose={() => setEditing(null)}
        />
      )}
      {uploading?.kind === 'plugin' && (
        <PluginDialog
          teamId={team.id}
          configs={live.filter((i) => i.assetOwnerId === me)}
          initialTarget={uploading.target?.id}
          reload={reload}
          onClose={() => setUploading(null)}
        />
      )}
      {uploading?.kind === 'preset' && (
        <PresetDialog teamId={team.id} target={uploading.target?.kind === 'preset' ? uploading.target : undefined} reload={reload} onClose={() => setUploading(null)} />
      )}
      {npm && <NpmPluginDialog teamId={team.id} reload={reload} plugin={npm === true ? undefined : npm} onClose={() => setNpm(null)} />}
    </>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="text-muted-foreground">{hint}</span>
      </p>
      <ul className="overflow-hidden rounded-lg border">{children}</ul>
    </section>
  );
}

function ItemIcon({ item, className }: { item: Item; className?: string }) {
  return item.kind === 'preset' ? (
    <PresetAvatar avatar={item.data.avatar} name={item.name} className={className ?? 'size-9'} />
  ) : (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground', className)}>
      <Puzzle className="size-4" aria-hidden />
    </span>
  );
}

function Tags({ mine, recommended, withdrawn }: { mine: boolean; recommended: boolean; withdrawn: boolean }) {
  const t = useTranslations('team.library.tags');
  return (
    <>
      {/* Navy says "this is the team's" (docs/design.md). */}
      {recommended && <span className="rounded bg-brand/10 px-1.5 text-xs font-medium text-brand dark:text-foreground">{t('recommended')}</span>}
      {mine && <span className="rounded bg-secondary px-1.5 text-xs font-medium">{t('mine')}</span>}
      {withdrawn && <span className="rounded border px-1.5 text-xs text-muted-foreground">{t('withdrawn')}</span>}
    </>
  );
}

/** One preset or plugin: what it is, who shares it and how many use it, and on the right, its state on the reader's DSH. */
function Row(props: {
  item: Item;
  name: string;
  author: string;
  users: number;
  use: AssetUse;
  mine: boolean;
  behind: boolean;
  hosts: Host[];
  off: string[];
  pending: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onUpdate: () => void;
}) {
  const { item, use } = props;
  const t = useTranslations('team.library');
  const description = item.kind === 'preset' ? item.data.description : item.data.description || `${item.data.package}@${item.data.version}`;
  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
      <button type="button" onClick={props.onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ItemIcon item={item} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {props.name}
            {/* Its group already says whether the team recommends it. */}
            <Tags mine={props.mine} recommended={false} withdrawn={!!item.assetArchived} />
          </span>
          {description && <span className="truncate text-xs text-muted-foreground">{description}</span>}
          <span className="text-xs text-muted-foreground">
            {props.author} · {t('users', { count: props.users })}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
        {props.behind && <span className="text-xs text-warning">{t('state.behind')}</span>}
        {use.update ? (
          <>
            <span className="text-xs text-warning">{t('state.update', { version: item.version })}</span>
            <Button size="sm" variant="outline" disabled={props.pending} onClick={props.onUpdate}>
              {t('update')}
            </Button>
          </>
        ) : use.on ? (
          use.how === 'pinned' ? (
            <span className="text-xs text-muted-foreground">{t('state.pinned', { version: use.version ?? 0 })}</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" aria-hidden />
              {/* Kept off some of the reader's computers: say on how many it is. */}
              {props.off.some((id) => props.hosts.some((h) => h.id === id))
                ? t('state.onSome', { on: props.hosts.filter((h) => !props.off.includes(h.id)).length, all: props.hosts.length })
                : t('state.onDsh')}
            </span>
          )
        ) : item.assetArchived ? null : (
          <Button size="sm" variant="outline" disabled={props.pending} onClick={props.onAdd}>
            {t('add')}
          </Button>
        )}
      </div>
    </li>
  );
}

/** One item in full, beside the list: what it needs, the reader's use of it, its author's and admin's actions, and its versions. */
function Details(props: {
  item: Item;
  teamId: string;
  choices: Choices;
  admin: boolean;
  mine: boolean;
  author: string;
  models: Model[];
  items: Item[];
  hosts: Host[];
  use: AssetUse;
  pending: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
  choose: Choose;
  onAdd: () => void;
  onUpdate: () => void;
  close: () => void;
  edit: () => void;
  upload: () => void;
}) {
  const { item, choices, use, pending, admin } = props;
  const t = useTranslations('team.library');
  const name = assetName(item, choices);
  const recommendation = choices.defaults[item.id];
  const recommended = isRecommended(item, choices);
  const [confirm, setConfirm] = useState<'withdraw' | 'delete' | null>(null);
  const [shownName, setShownName] = useState(recommendation?.name ?? '');
  const path = `teams/${props.teamId}`;
  const recommend = (version: number, message: string) =>
    props.run(() => api(`${path}/asset-defaults/${item.id}`, { method: 'PUT', body: { version, name: version ? shownName.trim() : '', revision: recommendation?.revision ?? 0 } }), message);
  // The team assistant is how a member reaches Teamwork from DSH, so it stays on every DSH.
  const removable = use.on && item.builtin !== 'team-assistant';
  const removeBody: Schemas['PersonalChoice'] = { mode: recommended ? 'removed' : 'default' };

  let state: ReactNode;
  if (item.assetArchived && !use.on) state = null;
  else if (!use.on) state = <Button disabled={pending} onClick={props.onAdd}>{t('addToDsh')}</Button>;
  else if (use.update) state = <Button disabled={pending} onClick={props.onUpdate}>{t('updateTo', { version: item.version })}</Button>;
  else
    state = (
      <span className="flex items-center gap-1.5 text-sm text-success">
        <Check className="size-4" aria-hidden />
        {use.how === 'pinned'
          ? t('onDsh.pinned', { version: use.version ?? 0 })
          : use.how === 'recommended'
            ? t('onDsh.recommended', { version: use.version ?? 0 })
            : use.how === 'team'
              ? t('onDsh.team')
              : t('onDsh.latest')}
      </span>
    );

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && props.close()}>
      {/* Focus starts on the panel itself, so no action looks chosen before the reader picks one; Tab reaches them all. */}
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-md translate-x-0 translate-y-0 gap-5 rounded-none border-y-0 border-r-0 outline-none sm:rounded-l-xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3">
            <ItemIcon item={item} className="size-11" />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5 break-words">
                {name}
                <Tags mine={props.mine} recommended={recommended} withdrawn={!!item.assetArchived} />
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {props.author} · v{item.version} · {t('users', { count: choices.users[item.id] ?? 0 })}
              </span>
            </span>
          </DialogTitle>
          {name !== item.name && <p className="text-xs text-muted-foreground">{t('originalName', { name: item.name })}</p>}
          <DialogDescription>{item.data.description || (item.kind === 'plugin' ? `${item.data.package}@${item.data.version}` : '')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {state}
          {removable && (
            <Button variant="ghost" disabled={pending} onClick={() => void props.choose(item, removeBody, t('removed'))}>
              {t('remove')}
            </Button>
          )}
        </div>
        {item.assetArchived && <p className="text-sm text-muted-foreground">{t('withdrawnNotice')}</p>}
        {item.kind === 'plugin' && use.on && <p className="text-xs text-muted-foreground">{t('pluginInstall')}</p>}

        <Needs item={item} models={props.models} items={props.items} choices={choices} />

        {use.on && props.hosts.length > 0 && item.builtin !== 'team-assistant' && (
          <Computers item={item} teamId={props.teamId} hosts={props.hosts} items={props.items} choices={choices} pending={pending} run={props.run} />
        )}

        {props.mine && !item.assetArchived && (
          <Panel title={t('author.title')}>
            <p className="text-sm text-muted-foreground">{t(recommendation?.version ? 'author.recommended' : 'author.body', { count: choices.users[item.id] ?? 0, version: recommendation?.version ?? 0 })}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={pending} onClick={props.edit}>
                {t(item.kind === 'preset' ? 'author.edit' : 'author.upload')}
              </Button>
              {item.kind === 'preset' && (
                <Button variant="ghost" size="sm" disabled={pending} onClick={props.upload}>
                  {t('author.import')}
                </Button>
              )}
              {!admin && (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm('withdraw')}>
                  {t('withdraw')}
                </Button>
              )}
            </div>
          </Panel>
        )}

        {admin && (
          <Panel title={t('manage.title')} team>
            {!item.assetOwnerId ? (
              <>
                <p className="text-sm text-muted-foreground">{t('manage.teamOwned')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={pending} onClick={props.edit}>
                    {t('manage.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm('delete')}>
                    {t('manage.delete')}
                  </Button>
                </div>
              </>
            ) : item.assetArchived ? (
              <p className="text-sm text-muted-foreground">{t('withdrawnNotice')}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {recommendation?.version ? t('manage.recommended', { version: recommendation.version }) : t('manage.notRecommended')}
                </p>
                {isBehind(item, choices) && (
                  // Amber, as a line: this recommendation waits on the admin (docs/design.md, "Component rules").
                  <p className="border-l-[3px] border-signal bg-muted px-3 py-2 text-sm">
                    {t('manage.behind', { author: props.author, latest: item.version, version: recommendation?.version ?? 0 })}
                  </p>
                )}
                {!!recommendation?.version && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="shown-name">{t('manage.displayName')}</Label>
                    <Input id="shown-name" maxLength={120} placeholder={item.name} value={shownName} onChange={(e) => setShownName(e.target.value)} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(!recommendation?.version || isBehind(item, choices)) && (
                    <Button size="sm" disabled={pending} onClick={() => void recommend(item.version, t('manage.recommendedToast', { version: item.version }))}>
                      {recommendation?.version ? t('manage.recommendVersion', { version: item.version }) : t('manage.recommend')}
                    </Button>
                  )}
                  {!!recommendation?.version && shownName.trim() !== recommendation.name && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => void recommend(recommendation.version, t('manage.nameSaved'))}>
                      {t('manage.saveName')}
                    </Button>
                  )}
                  {!!recommendation?.version && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => void recommend(0, t('manage.unrecommendedToast'))}>
                      {t('manage.unrecommend')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm('withdraw')}>
                    {t('withdraw')}
                  </Button>
                </div>
              </>
            )}
          </Panel>
        )}

        {confirm && (
          <section aria-label={t(confirm === 'withdraw' ? 'withdraw' : 'manage.delete')} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <p>{t(confirm === 'withdraw' ? 'withdrawConfirm' : 'manage.deleteConfirm', { name })}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirm(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  if (await props.run(() => api(`${path}/configs/${item.id}`, { method: 'DELETE' }), t(confirm === 'withdraw' ? 'withdrawn' : 'manage.deleted'))) props.close();
                }}
              >
                {t(confirm === 'withdraw' ? 'withdraw' : 'manage.delete')}
              </Button>
            </div>
          </section>
        )}

        {item.assetOwnerId && <Versions item={item} names={new Map([...props.models, ...props.items].map((i) => [i.id, i.name]))} teamId={props.teamId} use={use} recommended={recommendation?.version} follow={recommended ? 'default' : 'latest'} pending={pending} choose={props.choose} />}
      </DialogContent>
    </Dialog>
  );
}

function Panel({ title, team = false, children }: { title: string; team?: boolean; children: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-2.5 rounded-lg border p-3', team && 'border-brand/40')}>
      <h3 className={cn('text-sm font-semibold', team && 'text-brand dark:text-foreground')}>{title}</h3>
      {children}
    </section>
  );
}

/** What the item asks of the reader's DSH: its model and tools, and the plugins it depends on and whether they have them. */
function Needs({ item, models, items, choices }: { item: Item; models: Model[]; items: Item[]; choices: Choices }) {
  const t = useTranslations('team.library.needs');
  const rows: [string, ReactNode][] = [];
  if (item.kind === 'preset') {
    const model = models.find((m) => m.id === item.data.modelConfigId);
    rows.push([t('model'), item.data.inheritModel ? t('sessionModel') : model ? model.name : t('modelMissing')]);
    rows.push([t('tools'), item.data.requiredTools.length || item.data.optionalTools.length ? <Tools required={item.data.requiredTools} optional={item.data.optionalTools} /> : t('none')]);
    rows.push([
      t('plugins'),
      item.data.pluginDependencies.length
        ? item.data.pluginDependencies.map((dependency) => {
            const plugin = items.find((i): i is Plugin => i.id === dependency.pluginConfigId && i.kind === 'plugin');
            const on = plugin && reachOf(plugin, choices).on;
            return (
              <span key={dependency.pluginConfigId} className="mr-3 inline-flex items-center gap-1.5">
                {plugin?.name ?? t('pluginMissing')}
                <span className={cn('text-xs', on ? 'text-success' : 'text-warning')}>{t(on ? 'added' : 'notAdded')}</span>
              </span>
            );
          })
        : t('none'),
    ]);
  } else {
    const usedBy = items.filter((i): i is Preset => i.kind === 'preset' && i.data.pluginDependencies.some((d) => d.pluginConfigId === item.id));
    rows.push([t('package'), <span className="font-mono text-xs [overflow-wrap:anywhere]">{`${item.data.package}@${item.data.version}`}</span>]);
    rows.push([t('provides'), item.data.providesTools.length ? <Tools required={item.data.providesTools} optional={[]} /> : t('none')]);
    rows.push([t('usedBy'), usedBy.length ? usedBy.map((p) => p.name).join(t('separator')) : t('unused')]);
  }
  return (
    <Panel title={t('title')}>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/**
 * The reader's computers, each with a switch: the item syncs to every computer that is on, a newly connected one
 * included. A preset still carries the plugins it pins, so a plugin kept off a computer where such a preset is says
 * that the preset will still ask to install it there.
 */
function Computers(props: { item: Item; teamId: string; hosts: Host[]; items: Item[]; choices: Choices; pending: boolean; run: (action: () => Promise<unknown>, success?: string) => Promise<boolean> }) {
  const { item, hosts, choices } = props;
  const t = useTranslations('team.library.computers');
  const off = choices.off[item.id] ?? [];
  const onHost = (other: Item, host: string) => reachOf(other, choices).on && !(choices.off[other.id] ?? []).includes(host);
  const save = (next: string[], message: string) =>
    props.run(() => api(`teams/${props.teamId}/asset-choices/${item.id}/hosts`, { method: 'PUT', body: { off: next } }), message);
  const neededBy = (host: string): string | undefined => {
    if (item.kind !== 'plugin') return undefined;
    const presets = props.items.filter((p): p is Preset => p.kind === 'preset' && onHost(p, host) && p.data.pluginDependencies.some((d) => d.pluginConfigId === item.id));
    return presets.length ? t('neededBy', { presets: presets.map((p) => p.name).join(t('separator')) }) : undefined;
  };
  return (
    <Panel title={t('title')}>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <ul className="flex flex-col">
        {hosts.map((host) => {
          const on = !off.includes(host.id);
          const twin = twinOf(hosts, host);
          const warning = on ? undefined : neededBy(host.id);
          return (
            <li key={host.id} className="flex flex-col gap-0.5 border-t py-2 first:border-t-0">
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={on}
                  disabled={props.pending}
                  onChange={() =>
                    void save(on ? [...off, host.id] : off.filter((id) => id !== host.id), t(on ? 'turnedOff' : 'turnedOn', { name: host.name }))
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  {host.name}
                  {twin && <span className="ml-1 text-muted-foreground">{twin}</span>}
                </span>
                <span className={cn('text-xs', host.online ? 'text-success' : 'text-muted-foreground')}>{t(host.online ? 'online' : 'offline')}</span>
              </label>
              {warning && <p className="pl-6.5 text-xs text-warning">{warning}</p>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** A member's item version by version, newest first: each opens to its contents and can be pinned. */
function Versions({ item, names, teamId, use, recommended, follow, pending, choose }: {
  item: Item;
  names: ReadonlyMap<string, string>;
  teamId: string;
  use: AssetUse;
  recommended?: number;
  /** Where a pinned reader goes back to: the team's recommendation, or the latest version. */
  follow: 'default' | 'latest';
  pending: boolean;
  choose: Choose;
}) {
  const t = useTranslations('team.library.versions');
  const tl = useTranslations('team.library');
  const pinned = use.how === 'pinned' && !item.assetArchived;
  // A reader who pinned a version came here to choose one, so the list opens for them.
  const [open, setOpen] = useState(pinned);
  const format = useFormatter();
  const history = useApi<Schemas['ConfigRevision'][]>(`teams/${teamId}/history?configId=${item.id}`);
  const [shown, setShown] = useState<number | null>(null);
  const rows = (history.data ?? []).filter((r) => r.kind === item.kind);
  return (
    <details className="rounded-lg border p-3 text-sm" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="font-semibold">
        {t('title')} <span className="font-normal text-muted-foreground">{t('count', { count: item.version })}</span>
      </summary>
      {pinned && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{tl('onDsh.pinned', { version: use.version ?? 0 })}</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void choose(item, { mode: follow }, tl('followed'))}>
            {tl(follow === 'default' ? 'followRecommended' : 'followLatest')}
          </Button>
        </div>
      )}
      {!history.data ? (
        <p role="status" className="mt-2 text-muted-foreground">{t(history.error ? 'unavailable' : 'loading')}</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 border-t py-2 first:border-t-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">v{r.version}</span>
                <span className="text-xs text-muted-foreground">{format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}</span>
                {r.version === recommended && <span className="rounded bg-brand/10 px-1.5 text-xs font-medium text-brand dark:text-foreground">{t('recommended')}</span>}
                {use.on && r.version === use.version && <span className="rounded bg-secondary px-1.5 text-xs font-medium">{t('yours')}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-expanded={shown === r.version} onClick={() => setShown(shown === r.version ? null : r.version)}>
                    {t(shown === r.version ? 'hide' : 'show')}
                  </Button>
                  {!(use.how === 'pinned' && use.version === r.version) && !item.assetArchived && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => void choose(item, { mode: 'pinned', version: r.version }, t('pinned', { version: r.version }))}>
                      {t('pin')}
                    </Button>
                  )}
                </span>
              </div>
              {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
              {shown === r.version && <VersionPreview config={{ ...item, version: r.version, name: r.name, data: r.data } as Item} names={names} />}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** What a member has no use for: the mark drawn beside the name, and where the package's archive is kept. */
const HIDDEN = new Set(['name', 'avatar', 'packageId', 'sha256']);

/** A preset or plugin version in full, each field as the history shows it (lib/config-diff.ts reads the values). */
function VersionPreview({ config, names }: { config: Item; names: ReadonlyMap<string, string> }) {
  const td = useTranslations('team.diff');
  const fields = diffResource(null, { name: config.name, data: config.data }, names).filter((f) => !HIDDEN.has(f.key));
  const label = (key: string) => (td.has(`fields.${key}`) ? td(`fields.${key}`) : key);
  const say = (value: string) => (value === 'true' ? td('yes') : value === 'false' ? td('no') : value);
  return (
    <dl className="rounded-md border text-xs">
      {fields.map((f) => (
        <div key={f.key} className="grid gap-1 border-t px-2.5 py-1.5 first:border-t-0 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3">
          <dt className="text-muted-foreground">{label(f.key)}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            {f.long ? <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">{f.after}</pre> : say(f.after)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
