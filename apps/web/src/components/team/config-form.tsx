'use client';

/**
 * Publish or edit one team configuration. The server parses the result with
 * `ConfigInputSchema`; this form only shapes the fields into it, so a rule
 * lives in one place.
 */

import type { ConfigKind, ModelCatalog, TeamConfigView } from '@dsh-teamwork/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { callApi } from '@/lib/api-client';

import { useMutation } from './use-mutation';

type Data = Record<string, unknown>;
const lines = (value: string) => value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const optionalNumber = (value: string) => (value ? Number(value) : undefined);

export function ConfigForm({ editing, configs, onDone }: { editing: TeamConfigView | null; configs: TeamConfigView[]; onDone: () => void }) {
  const t = useTranslations('team');
  const { pending, run } = useMutation();
  const [kind, setKind] = useState<ConfigKind>(editing?.kind ?? 'preset');
  const initial = (editing?.data ?? {}) as Data;

  function submit(form: HTMLFormElement) {
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? '');
    let data: Data;
    if (kind === 'plugin') {
      data = { package: text('package'), version: text('version'), description: text('description'), providesTools: lines(text('providesTools')) };
    } else {
      const ownRoute = {
        provider: text('provider'),
        model: text('model'),
        contextWindow: optionalNumber(text('contextWindow')),
        maxTokens: optionalNumber(text('maxTokens')),
      };
      if (kind === 'model') data = ownRoute;
      else {
        const modelConfigId = text('modelConfigId');
        data = {
          ...(modelConfigId ? { modelConfigId } : ownRoute),
          description: text('description'),
          instructions: text('instructions'),
          outputDescription: text('outputDescription'),
          systemPrompt: text('systemPrompt'),
          requiredTools: lines(text('requiredTools')),
          optionalTools: lines(text('optionalTools')),
          pluginDependencies: values.getAll('pluginDependency').map((id) => ({
            pluginConfigId: String(id),
            version: (configs.find((c) => c.id === id)?.data as Data | undefined)?.version,
          })),
        };
      }
    }
    const body = { kind, name: text('name'), data, ...(editing ? { version: editing.version } : {}) };
    run(async () => {
      await callApi(editing ? `team/configs/${editing.id}` : 'team/configs', editing ? 'PATCH' : 'POST', body);
      onDone();
      if (!editing) form.reset();
    }, t('form.saved'));
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <Field label={t('form.kind')}>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ConfigKind)} disabled={!!editing}>
          <option value="preset">{t('kind.preset')}</option>
          <option value="model">{t('kind.model')}</option>
          <option value="plugin">{t('kind.plugin')}</option>
        </NativeSelect>
      </Field>
      <Field label={t('form.name')}>
        <Input name="name" defaultValue={editing?.name} maxLength={100} required />
      </Field>

      {kind === 'plugin' && (
        <>
          <Field label={t('form.package')}>
            <Input name="package" defaultValue={initial.package as string} placeholder="@scope/name" required />
          </Field>
          <Field label={t('form.version')}>
            <Input name="version" defaultValue={initial.version as string} placeholder="1.0.0" required />
          </Field>
          <Field label={t('form.description')}>
            <Textarea name="description" defaultValue={initial.description as string} maxLength={1000} />
          </Field>
          <Field label={t('form.providesTools')}>
            <Textarea name="providesTools" defaultValue={(initial.providesTools as string[] | undefined)?.join('\n')} />
          </Field>
        </>
      )}

      {kind === 'model' && <ModelFields initial={initial} />}

      {kind === 'preset' && <PresetFields initial={initial} configs={configs} />}

      <div className="flex gap-2">
        <Button disabled={pending}>{t('form.save')}</Button>
        {editing && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('form.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        <span className="flex w-full flex-col gap-1.5">
          {label}
          {children}
        </span>
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type CatalogModel = Extract<ModelCatalog, { models: unknown }>['models'][number];

/** Provider and model, with the provider's own catalogue offered when the server can reach it. */
function ModelFields({ initial }: { initial: Data }) {
  const t = useTranslations('team');
  const [provider, setProvider] = useState((initial.provider as string) ?? '');
  const [model, setModel] = useState((initial.model as string) ?? '');
  const [contextWindow, setContextWindow] = useState(String(initial.contextWindow ?? ''));
  const [maxTokens, setMaxTokens] = useState(String(initial.maxTokens ?? ''));
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    callApi<{ providers: string[] }>('team/model-catalog')
      .then((r) => active && setProviders(r.providers))
      .catch(() => active && setNote(t('form.catalogUnavailable')));
    return () => {
      active = false;
    };
  }, [t]);

  async function fetchModels() {
    setLoading(true);
    setNote('');
    try {
      const r = await callApi<{ models: CatalogModel[] }>(`team/model-catalog?provider=${encodeURIComponent(provider)}`);
      setModels(r.models);
      if (!r.models.length) setNote(t('form.catalogEmpty'));
    } catch {
      setNote(t('form.catalogUnavailable'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Field label={t('form.provider')}>
        <Input
          name="provider"
          list="team-providers"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModels([]);
          }}
          required
        />
      </Field>
      <datalist id="team-providers">
        {providers.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={loading || !provider} onClick={fetchModels}>
        {t('form.fetchModels')}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <Field label={t('form.model')}>
        <Input
          name="model"
          list="team-models"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            const found = models.find((m) => m.id === e.target.value);
            if (found) {
              setContextWindow(String(found.contextWindow ?? ''));
              setMaxTokens(String(found.maxTokens ?? ''));
            }
          }}
          required
        />
      </Field>
      <datalist id="team-models">
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
      <Field label={t('form.contextWindow')}>
        <Input name="contextWindow" type="number" min={1} value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
      </Field>
      <Field label={t('form.maxTokens')} hint={t('form.limitsHint')}>
        <Input name="maxTokens" type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
      </Field>
    </>
  );
}

function PresetFields({ initial, configs }: { initial: Data; configs: TeamConfigView[] }) {
  const t = useTranslations('team');
  const models = configs.filter((c) => c.kind === 'model');
  const plugins = configs.filter((c) => c.kind === 'plugin');
  const ownRoute = !!initial.provider && !initial.modelConfigId;
  const [modelId, setModelId] = useState((initial.modelConfigId as string) ?? '');
  const pinned = (initial.pluginDependencies as { pluginConfigId: string }[] | undefined) ?? [];

  return (
    <>
      <Field label={t('form.modelRef')} hint={models.length ? undefined : t('form.noModels')}>
        <NativeSelect name="modelConfigId" value={modelId} onChange={(e) => setModelId(e.target.value)} required={!ownRoute}>
          <option value="">{ownRoute ? t('form.keepOwnRoute') : t('form.chooseModel')}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · v{m.version}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {ownRoute && !modelId && <ModelFields initial={initial} />}
      <Field label={t('form.description')}>
        <Textarea name="description" defaultValue={initial.description as string} maxLength={500} />
      </Field>
      <Field label={t('form.instructions')}>
        <Textarea name="instructions" defaultValue={initial.instructions as string} maxLength={4000} />
      </Field>
      <Field label={t('form.outputDescription')}>
        <Textarea name="outputDescription" defaultValue={initial.outputDescription as string} maxLength={2000} />
      </Field>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium">{t('form.plugins')}</legend>
        {plugins.length === 0 && <p className="text-xs text-muted-foreground">{t('form.noPlugins')}</p>}
        {plugins.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input type="checkbox" name="pluginDependency" value={p.id} defaultChecked={pinned.some((d) => d.pluginConfigId === p.id)} />
            {p.name} · {(p.data as Data).package as string}@{(p.data as Data).version as string}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">{t('form.pluginsHint')}</p>
      </fieldset>
      <Field label={t('form.requiredTools')}>
        <Textarea name="requiredTools" defaultValue={(initial.requiredTools as string[] | undefined)?.join('\n')} />
      </Field>
      <Field label={t('form.optionalTools')}>
        <Textarea name="optionalTools" defaultValue={(initial.optionalTools as string[] | undefined)?.join('\n')} />
      </Field>
      <Field label={t('form.systemPrompt')} hint={t('form.systemPromptHint')}>
        <Textarea name="systemPrompt" defaultValue={initial.systemPrompt as string} maxLength={20_000} className="min-h-32" />
      </Field>
    </>
  );
}
