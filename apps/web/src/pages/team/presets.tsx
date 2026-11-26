/**
 * The preset editor. A preset is a role the team shares: the team model it
 * calls, the DSH tools it needs, the plugins it pins and the persona it works
 * by. It starts from a template (`PRESET_TEMPLATES`, copied in the writer's
 * language and theirs from then on) or from nothing, in an editor with three
 * tabs; each has an avatar from the library the phone app shares
 * (`@dsh-teamwork/shared`). Presets and plugins (library.tsx) opens it: an
 * admin's new preset is the team's own, a member's is theirs to share.
 */

import { PRESET_AVATARS, presetAvatar } from '@dsh-teamwork/shared';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { ProviderMark } from '@/components/provider-mark';
import { PresetAvatarPicker } from '@/components/preset-avatar';
import { Field } from '@/components/team/field';
import { useMutation } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, type ConfigOf } from '@/lib/api';
import { DSH_TOOLS } from '@/lib/preset-templates';
import { cn } from '@/lib/utils';

type Preset = ConfigOf<'preset'>;
type Model = ConfigOf<'model'>;
type Plugin = ConfigOf<'plugin'>;
type Reload = () => Promise<unknown>;

/** What the editor edits; `route` keeps a preset that names its own provider and model as it is. */
export interface Draft {
  name: string;
  /** An id from the avatar library; the editor always saves one. */
  avatar: string;
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

/** An empty preset, calling the team's first model, with an avatar picked at random. */
export function blankDraft(models: Model[]): Draft {
  return {
    name: '',
    avatar: PRESET_AVATARS[Math.floor(Math.random() * PRESET_AVATARS.length)]!.id,
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
    // The one it shows, so saving a preset that predates avatars keeps the face it already had.
    avatar: presetAvatar(preset.data.avatar, preset.name).id,
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

/** A preset's tools: required ones filled, optional ones dashed. */
export function Tools({ required, optional }: { required: string[]; optional: string[] }) {
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

type Tab = 'basics' | 'tools' | 'persona';

/** Publish or edit one preset; the server checks its model and plugin pins belong to the team, at those versions. */
export function PresetEditor({
  teamId,
  memberAsset = false,
  reload,
  initial,
  preset,
  template,
  models,
  plugins,
  onClose,
}: {
  teamId: string;
  memberAsset?: boolean;
  reload: Reload;
  initial: Draft;
  preset?: Preset;
  template?: string;
  models: Model[];
  plugins: Plugin[];
  onClose: () => void;
}) {
  const t = useTranslations('team.presets');
  const tr = useTranslations('team.library.upload');
  const tools = useTranslations('team.tools');
  const avatars = useTranslations('team.avatars');
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
  const ready = draft.name.trim() && (draft.modelConfigId || (!memberAsset && draft.route));
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
      avatar: draft.avatar,
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
    const body = { memberAsset, kind: 'preset', name: draft.name.trim(), data, ...(preset ? { version: preset.version } : {}) };
    const saved = await run(
      () => api(preset ? `teams/${teamId}/configs/${preset.id}` : `teams/${teamId}/configs`, { method: preset ? 'PATCH' : 'POST', body }),
      preset ? t('saved') : t('added', { name: body.name }),
    );
    if (saved) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{preset ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>{memberAsset ? tr('publicationHint') : template ? t('fromTemplate', { name: template }) : t('editorHint')}</DialogDescription>
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
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('avatar')}</span>
                <PresetAvatarPicker value={draft.avatar} label={t('avatar')} nameOf={(id) => (avatars.has(id) ? avatars(id) : id)} onChange={(id) => set('avatar', id)} />
              </div>
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
                    ...(!memberAsset && draft.route
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
            {preset ? t('save') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
