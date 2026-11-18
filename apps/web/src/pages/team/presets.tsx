/**
 * A team's presets page (`/teams/{teamId}/presets`). A preset is a role the
 * whole team shares: the team model it calls, the DSH tools it needs, the
 * plugins it pins and the persona it works by. An admin starts one from a
 * template (`PRESET_TEMPLATES`, copied in the admin's language and the team's
 * own from then on) or from nothing, in an editor with three tabs. It is Team
 * management's (ADR 0043); a member reads the presets in Team resources and
 * proposes one, or a change to one, in the same editor, which sends it to
 * review instead of publishing it.
 */

import { ChevronDown, Cpu, Plus, Puzzle } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { ProviderMark } from '@/components/provider-mark';
import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { Field } from '@/components/team/field';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, type ConfigOf, type Team, type TeamConfig } from '@/lib/api';
import { DSH_TOOLS, PRESET_TEMPLATES, type PresetTemplate } from '@/lib/preset-templates';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type Preset = ConfigOf<'preset'>;
type Model = ConfigOf<'model'>;
type Plugin = ConfigOf<'plugin'>;
type Reload = () => Promise<unknown>;

/** What the editor edits; `route` keeps a preset that names its own provider and model as it is. */
export interface Draft {
  name: string;
  description: string;
  modelConfigId: string;
  route: { provider: string; model: string; contextWindow?: number; maxTokens?: number } | null;
  outputDescription: string;
  instructions: string;
  systemPrompt: string;
  required: string[];
  optional: string[];
  plugins: string[];
}

/** An empty preset, calling the team's first model. */
export function blankDraft(models: Model[]): Draft {
  return {
    name: '',
    description: '',
    modelConfigId: models[0]?.id ?? '__inherit__',
    route: null,
    outputDescription: '',
    instructions: '',
    systemPrompt: '',
    required: [],
    optional: [],
    plugins: [],
  };
}

/** A published preset, as the editor edits it. */
export function presetDraft(preset: Preset): Draft {
  return {
    name: preset.name,
    description: preset.data.description,
    modelConfigId: preset.data.inheritModel ? '__inherit__' : preset.data.modelConfigId ?? '',
    route: preset.data.modelConfigId || !preset.data.provider || !preset.data.model
      ? null
      : { provider: preset.data.provider, model: preset.data.model, contextWindow: preset.data.contextWindow, maxTokens: preset.data.maxTokens },
    outputDescription: preset.data.outputDescription,
    instructions: preset.data.instructions,
    systemPrompt: preset.data.systemPrompt,
    required: [...preset.data.requiredTools],
    optional: [...preset.data.optionalTools],
    plugins: preset.data.pluginDependencies.map((d) => d.pluginConfigId),
  };
}

export function TeamPresetsPage() {
  const { team } = useTeam();
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  return <Presets team={team} configs={configs.data} reload={configs.reload} />;
}

function Presets({ team, configs, reload }: { team: Team; configs: TeamConfig[]; reload: Reload }) {
  const t = useTranslations('team.presets');
  const tt = useTranslations('team.templates');
  const presets = configs.filter((c): c is Preset => c.kind === 'preset').sort((a,b)=>Number(b.builtin === 'team-assistant')-Number(a.builtin === 'team-assistant'));
  const models = configs.filter((c): c is Model => c.kind === 'model');
  const plugins = configs.filter((c): c is Plugin => c.kind === 'plugin');
  const [editing, setEditing] = useState<{ draft: Draft; preset?: Preset; template?: string } | null>(null);

  const fromTemplate = (template: PresetTemplate): Draft => ({
    ...blankDraft(models),
    name: tt(`${template.id}.name`),
    description: tt(`${template.id}.description`),
    outputDescription: tt(`${template.id}.deliverable`),
    // Raw: a persona is prose with line breaks, not a message with placeholders.
    systemPrompt: tt.raw(`${template.id}.systemPrompt`) as string,
    required: [...template.requiredTools],
    optional: [...template.optionalTools],
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('intro')}
        action={
          (
            <Button variant="outline" onClick={() => setEditing({ draft: blankDraft(models) })}>
              <Plus />
              {t('blank')}
            </Button>
          )
        }
      />

      {presets.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        // Rows, not cards (docs/design.md, "Lists are rows"): the templates below are the one block set apart.
        <ul className="divide-y rounded-lg border bg-card">
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              teamId={team.id}
              reload={reload}
              preset={p}
              model={models.find((m) => m.id === p.data.modelConfigId)}
              plugins={plugins}
              onEdit={() => setEditing({ draft: presetDraft(p), preset: p })}
            />
          ))}
        </ul>
      )}

      {(
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{t('templatesTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('templatesHint')}</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-3">
            {PRESET_TEMPLATES.map((template) => (
              <li key={template.id} className="flex flex-col gap-3 rounded-lg border border-dashed bg-card p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{tt(`${template.id}.area`)}</span>
                  <h3 className="font-semibold">{tt(`${template.id}.name`)}</h3>
                  <p className="text-sm text-muted-foreground">{tt(`${template.id}.persona`)}</p>
                </div>
                <Tools required={template.requiredTools} optional={template.optionalTools} />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-auto self-start"
                  onClick={() => setEditing({ draft: fromTemplate(template), template: tt(`${template.id}.name`) })}
                >
                  <Plus />
                  {t('useTemplate')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <PresetEditor
          teamId={team.id}
          submitForReview={false}
          reload={reload}
          initial={editing.draft}
          preset={editing.preset}
          template={editing.template}
          models={models}
          plugins={plugins}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function Tools({ required, optional }: { required: string[]; optional: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {required.map((name) => (
        <span key={name} className="rounded border bg-muted px-1.5 font-mono text-xs">
          {name}
        </span>
      ))}
      {optional.map((name) => (
        <span key={name} className="rounded border border-dashed px-1.5 font-mono text-xs text-muted-foreground">
          {name}
        </span>
      ))}
    </span>
  );
}

function PresetCard({
  teamId,
  reload,
  preset,
  model,
  plugins,
  onEdit,
}: {
  teamId: string;
  reload: Reload;
  preset: Preset;
  model: Model | undefined;
  plugins: Plugin[];
  onEdit: () => void;
}) {
  const t = useTranslations('team.presets');
  const { pending, run } = useMutation(reload);
  const [open, setOpen] = useState(false);
  const route = preset.data.inheritModel ? t('inheritModel') : preset.data.modelConfigId ? (model?.name ?? t('modelMissing')) : `${preset.data.provider} / ${preset.data.model}`;
  const pinned = preset.data.pluginDependencies.map((d) => {
    const plugin = plugins.find((p) => p.id === d.pluginConfigId);
    return plugin ? `${plugin.name} @${d.version}` : t('pluginMissing');
  });
  // A pin to a version the plugin no longer has: saving the preset again re-pins it at the current one.
  const stale = preset.data.pluginDependencies.some((d) => plugins.find((p) => p.id === d.pluginConfigId)?.data.version !== d.version);
  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{preset.name}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">v{preset.version}</span>
      </div>
      {preset.data.description && <p className="text-sm text-muted-foreground">{preset.data.description}</p>}
      <Tools required={preset.data.requiredTools} optional={preset.data.optionalTools} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-3">
          <span className={cn('flex items-center gap-1', preset.data.modelConfigId && !model && 'text-destructive')}>
            {model ? <ProviderMark hints={[model.data.model, model.name, model.data.provider]} name={model.name} /> : preset.data.model ? <ProviderMark hints={[preset.data.model, preset.data.provider]} name={preset.data.model} /> : <Cpu className="size-3.5" aria-hidden />}
            {route}
          </span>
          {pinned.length > 0 && (
            <span className={cn('flex items-center gap-1', stale && 'text-destructive')} title={stale ? t('pinStale') : undefined}>
              <Puzzle className="size-3.5" aria-hidden />
              {pinned.join(', ')}
              {stale && ` · ${t('pinStaleShort')}`}
            </span>
          )}
        </span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t('details')}
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
          {(
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                {t('edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (confirm(t('removeConfirm', { name: preset.name }))) void run(() => api(`teams/${teamId}/configs/${preset.id}`, { method: 'DELETE' }), t('removed'));
                }}
              >
                {t('remove')}
              </Button>
            </>
          )}
        </span>
      </div>
      {open && (
        <dl className="grid gap-3 border-t pt-3 text-sm">
          <Detail label={t('deliverable')} value={preset.data.outputDescription} />
          <Detail label={t('instructions')} value={preset.data.instructions} />
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">{t('persona')}</dt>
            <dd className="max-h-64 overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{preset.data.systemPrompt || '—'}</dd>
          </div>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
        </dl>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  );
}

type Tab = 'basics' | 'tools' | 'persona';

/** Publish or edit one preset; the server checks its model and plugin pins belong to the team, at those versions. */
export function PresetEditor({
  teamId,
  submitForReview,
  reload,
  initial,
  preset,
  template,
  models,
  plugins,
  onClose,
}: {
  teamId: string;
  submitForReview: boolean;
  reload: Reload;
  initial: Draft;
  preset?: Preset;
  template?: string;
  models: Model[];
  plugins: Plugin[];
  onClose: () => void;
}) {
  const t = useTranslations('team.presets');
  const tools = useTranslations('team.tools');
  const { pending, run } = useMutation(reload);
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<Tab>('basics');
  const [extra, setExtra] = useState('');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  // A tool the preset names that DSH does not ship (a plugin's, say) keeps its own row, even while it is off.
  const isDsh = (name: string) => (DSH_TOOLS as readonly string[]).includes(name);
  const [others, setOthers] = useState(() => [...initial.required, ...initial.optional].filter((n) => !isDsh(n)));
  const names = [...DSH_TOOLS, ...others];
  const state = (name: string) => (draft.required.includes(name) ? 'required' : draft.optional.includes(name) ? 'optional' : 'off');
  const choose = (name: string, next: 'required' | 'optional' | 'off') =>
    setDraft((d) => ({
      ...d,
      required: next === 'required' ? [...d.required.filter((n) => n !== name), name] : d.required.filter((n) => n !== name),
      optional: next === 'optional' ? [...d.optional.filter((n) => n !== name), name] : d.optional.filter((n) => n !== name),
    }));
  const ready = draft.name.trim() && (draft.modelConfigId || draft.route);
  function addExtra() {
    const name = extra.trim();
    if (!name) return;
    if (!isDsh(name) && !others.includes(name)) setOthers([...others, name]);
    choose(name, 'required');
    setExtra('');
  }

  async function save() {
    const data = {
      ...(draft.modelConfigId === '__inherit__' ? {inheritModel:true} : draft.modelConfigId ? { modelConfigId: draft.modelConfigId } : draft.route),
      description: draft.description,
      outputDescription: draft.outputDescription,
      instructions: draft.instructions,
      systemPrompt: draft.systemPrompt,
      requiredTools: draft.required,
      optionalTools: draft.optional,
      pluginDependencies: draft.plugins.flatMap((id) => {
        const plugin = plugins.find((p) => p.id === id);
        return plugin ? [{ pluginConfigId: id, version: plugin.data.version }] : [];
      }),
    };
    const body = { kind: 'preset', name: draft.name.trim(), data, ...(preset ? { version: preset.version } : {}) };
    const saved = await run(
      () => submitForReview ? (async()=>{const draft=await api<{id:string;revision:number}>(`teams/${teamId}/submissions`,{body:{config:{kind:'preset',name:body.name,data},configId:preset?.id,baseVersion:preset?.version ?? 0,note:''}});return api(`teams/${teamId}/submissions/${draft.id}/submit`,{body:{revision:draft.revision}});})() : api(preset ? `teams/${teamId}/configs/${preset.id}` : `teams/${teamId}/configs`, { method: preset ? 'PATCH' : 'POST', body }),
      submitForReview ? t('submitted') : preset ? t('saved') : t('added', { name: body.name }),
    );
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{preset ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>{template ? t('fromTemplate', { name: template }) : t('editorHint')}</DialogDescription>
        </DialogHeader>

        <div role="tablist" className="flex gap-1 border-b">
          {(['basics', 'tools', 'persona'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                tab === key ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tab.${key}`)}
            </button>
          ))}
        </div>

        <form
          id="preset-editor"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {tab === 'basics' && (
            <>
              <Field id="preset-name" label={t('name')}>
                <Input id="preset-name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required />
              </Field>
              <Field id="preset-description" label={t('description')} hint={t('descriptionHint')}>
                <Input id="preset-description" value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />
              </Field>
              <Field id="preset-model" label={t('model')} hint={models.length || draft.route ? undefined : t('noModels')}>
                <Select
                  id="preset-model"
                  label={t('model')}
                  value={draft.modelConfigId}
                  options={[
                    { value: '__inherit__', label: t('inheritModel') },
                    ...(draft.route
                      ? [{ value: '', label: t('keepRoute', { route: `${draft.route.provider} / ${draft.route.model}` }) }]
                      : draft.modelConfigId
                        ? []
                        : [{ value: '', label: t('chooseModel') }]),
                    ...models.map((m) => ({ value: m.id, label: m.name, icon: <ProviderMark hints={[m.data.model, m.name, m.data.provider]} name={m.name} /> })),
                  ]}
                  change={(value) => set('modelConfigId', value)}
                  className="w-full"
                />
              </Field>
              <Field id="preset-deliverable" label={t('deliverable')} hint={t('deliverableHint')}>
                <Input id="preset-deliverable" value={draft.outputDescription} onChange={(e) => set('outputDescription', e.target.value)} maxLength={2000} />
              </Field>
            </>
          )}

          {tab === 'tools' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('tools')}</span>
                <p className="text-xs text-muted-foreground">{t('toolsHint')}</p>
                <ul className="rounded-md border">
                  {names.map((name) => (
                    <li key={name} className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-sm">{name}</span>
                        <span className="text-xs text-muted-foreground">{tools.has(name) ? tools(name) : t('otherTool')}</span>
                      </span>
                      <span role="radiogroup" aria-label={name} className="flex shrink-0 overflow-hidden rounded-md border text-xs">
                        {(['required', 'optional', 'off'] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={state(name) === option}
                            onClick={() => choose(name, option)}
                            className={cn(
                              'border-l px-2.5 py-1 first:border-l-0',
                              state(name) === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                            )}
                          >
                            {t(`tool.${option}`)}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Input
                    aria-label={t('addTool')}
                    placeholder={t('addTool')}
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    // Enter adds the tool; left alone it would submit, and publish, the whole preset.
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      addExtra();
                    }}
                    maxLength={100}
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" disabled={!extra.trim()} onClick={addExtra}>
                    {t('add')}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('plugins')}</span>
                {plugins.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('noPlugins')}</p>
                ) : (
                  plugins.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.plugins.includes(p.id)}
                        onChange={(e) => set('plugins', e.target.checked ? [...draft.plugins, p.id] : draft.plugins.filter((id) => id !== p.id))}
                      />
                      {p.name}
                      <code className="text-xs text-muted-foreground">
                        {p.data.package}@{p.data.version}
                      </code>
                    </label>
                  ))
                )}
                <p className="text-xs text-muted-foreground">{t('pluginsHint')}</p>
              </div>
            </>
          )}

          {tab === 'persona' && (
            <>
              <Field id="preset-prompt" label={t('persona')} hint={t('personaHint')}>
                <Textarea
                  id="preset-prompt"
                  value={draft.systemPrompt}
                  onChange={(e) => set('systemPrompt', e.target.value)}
                  maxLength={20_000}
                  className="min-h-64 font-mono text-xs"
                />
              </Field>
              <Field id="preset-instructions" label={t('instructions')} hint={t('instructionsHint')}>
                <Textarea id="preset-instructions" value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} maxLength={4000} />
              </Field>
            </>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="preset-editor" disabled={pending || !ready}>
            {submitForReview ? t('submitForReview') : preset ? t('save') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
