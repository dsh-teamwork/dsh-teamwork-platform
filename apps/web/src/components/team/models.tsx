'use client';

/**
 * A team's models page (`/teams/{teamId}/models`). An admin connects a
 * provider by picking it from `PROVIDER_CATALOG` and pasting its key, or by
 * entering an OpenAI-compatible address by hand, then reads the provider's
 * model list and publishes the ones the team should use. Members see the team
 * models only: never an address or a key.
 */

import type { ModelCatalog, ProviderView, TeamConfigView, TeamView } from '@dsh-teamwork/shared';
import { KeyRound, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { callApi } from '@/lib/api-client';
import { catalogEntry, PROVIDER_CATALOG } from '@/lib/provider-catalog';

import { PageHeader } from './console-shell';
import { useMutation } from './use-mutation';

type ModelConfig = Extract<TeamConfigView, { kind: 'model' }>;
type CatalogModel = Extract<ModelCatalog, { models: unknown }>['models'][number];

/** 131072 → "131K", 1048576 → "1M": a model's limits at a glance. */
function tokens(n: number | undefined) {
  if (!n) return '—';
  return n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : `${Math.round(n / 1000)}K`;
}

interface Props {
  team: TeamView;
  configs: TeamConfigView[];
  /** The team's providers; empty for a member, who does not see them. */
  providers: ProviderView[];
}

export function Models({ team, configs, providers }: Props) {
  const t = useTranslations('team.models');
  const admin = team.role === 'admin';
  const models = configs.filter((c): c is ModelConfig => c.kind === 'model');
  const usedBy = (id: string) => configs.filter((c) => c.kind === 'preset' && c.data.modelConfigId === id);
  // Which provider the dialog connects or adds models to: `true` for a new one.
  const [adding, setAdding] = useState<ProviderView | true | null>(null);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={admin ? t('descriptionAdmin') : t('descriptionMember')}
        action={
          admin && (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              {t('addProvider')}
            </Button>
          )
        }
      />

      {admin && providers.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <ProviderCard key={p.id} teamId={team.id} provider={p} count={models.filter((m) => m.data.provider === p.name).length} onAddModels={() => setAdding(p)} />
          ))}
        </ul>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('teamModels')}</h2>
          <span className="text-xs text-muted-foreground">{t('count', { count: models.length })}</span>
        </div>
        {models.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
            {admin ? t('emptyAdmin') : t('emptyMember')}
            {admin && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus />
                {t('addProvider')}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t('name')}</th>
                  {admin && <th className="px-4 py-2.5 font-medium">{t('route')}</th>}
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t('context')}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t('maxOutput')}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t('usedBy')}</th>
                  {admin && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <ModelRow key={m.id} teamId={team.id} model={m} admin={admin} usedBy={usedBy(m.id).map((p) => p.name)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {admin && adding && (
        <ConnectDialog
          teamId={team.id}
          existing={adding === true ? null : adding}
          providers={providers}
          published={models}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  );
}

function ProviderCard({ teamId, provider, count, onAddModels }: { teamId: string; provider: ProviderView; count: number; onAddModels: () => void }) {
  const t = useTranslations('team.models');
  const tc = useTranslations('team.catalog');
  const { pending, run } = useMutation();
  const [rekey, setRekey] = useState(false);
  const entry = catalogEntry(provider.baseUrl);
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <Mark text={entry?.mark ?? provider.name.slice(0, 2).toUpperCase()} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{entry && entry.id === provider.name ? tc(entry.id) : provider.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={provider.baseUrl}>
            {provider.baseUrl}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <KeyRound className="size-3" aria-hidden />
          {t('keySaved')}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{t('count', { count })}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={onAddModels}>
          {t('addModels')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRekey(true)}>
          {t('rekey')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (confirm(t('removeProviderConfirm', { name: provider.name }))) void run(() => callApi(`teams/${teamId}/providers/${provider.id}`, 'DELETE'), t('providerRemoved'));
          }}
        >
          {t('remove')}
        </Button>
      </div>
      {rekey && <RekeyDialog teamId={teamId} provider={provider} onClose={() => setRekey(false)} />}
    </li>
  );
}

function Mark({ text }: { text: string }) {
  return <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-brand">{text}</span>;
}

function ModelRow({ teamId, model, admin, usedBy }: { teamId: string; model: ModelConfig; admin: boolean; usedBy: string[] }) {
  const t = useTranslations('team.models');
  const { pending, run } = useMutation();
  const [editing, setEditing] = useState(false);
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 font-medium">{model.name}</td>
      {admin && (
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {model.data.provider} / {model.data.model}
        </td>
      )}
      <td className="px-4 py-3 tabular-nums">{tokens(model.data.contextWindow)}</td>
      <td className="px-4 py-3 tabular-nums">{tokens(model.data.maxTokens)}</td>
      <td className="px-4 py-3">
        {usedBy.length ? (
          <span className="flex flex-wrap gap-1">
            {usedBy.map((name) => (
              <span key={name} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {name}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('unused')}</span>
        )}
      </td>
      {admin && (
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const question = usedBy.length ? t('removeModelUsed', { name: model.name, count: usedBy.length }) : t('removeModelConfirm', { name: model.name });
              if (confirm(question)) void run(() => callApi(`teams/${teamId}/configs/${model.id}`, 'DELETE'), t('modelRemoved'));
            }}
          >
            {t('remove')}
          </Button>
          {editing && <EditModelDialog teamId={teamId} model={model} onClose={() => setEditing(false)} />}
        </td>
      )}
    </tr>
  );
}

/**
 * Connect a provider and publish some of its models: pick from the catalog or
 * enter an address, paste the key, read the provider's `/models`, tick. With
 * `existing`, the provider is already connected and the dialog starts at the
 * model list. A provider that does not list its models takes a model id typed
 * by hand.
 */
function ConnectDialog({
  teamId,
  existing,
  providers,
  published,
  onClose,
}: {
  teamId: string;
  existing: ProviderView | null;
  providers: ProviderView[];
  published: ModelConfig[];
  onClose: () => void;
}) {
  const t = useTranslations('team.models');
  const tc = useTranslations('team.catalog');
  const { pending, run } = useMutation();
  const [pick, setPick] = useState<string | null>(existing ? existing.name : null);
  const [name, setName] = useState(existing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  // The connected provider's name, once it is saved; then its model list.
  const [connected, setConnected] = useState<string | null>(existing?.name ?? null);
  const [listed, setListed] = useState<CatalogModel[] | null>(null);
  const [manual, setManual] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState({ id: '', name: '' });
  const taken = new Set(providers.map((p) => p.name));
  const custom = pick === 'custom';

  // Reading the list never fails the dialog: a provider without `/models` is filled in by hand.
  async function readModels(provider: string) {
    try {
      const catalog = await callApi<{ models: CatalogModel[] }>(`teams/${teamId}/model-catalog?provider=${encodeURIComponent(provider)}`);
      const fresh = catalog.models.filter((m) => !published.some((p) => p.data.provider === provider && p.data.model === m.id));
      setListed(fresh);
      setManual(catalog.models.length === 0);
    } catch {
      setListed([]);
      setManual(true);
    }
  }

  // Opened for a connected provider: go straight to its list, once.
  const existingName = existing?.name;
  useEffect(() => {
    if (existingName) void readModels(existingName);
    // readModels is recreated each render; the list is read once per opened dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingName]);

  async function connect() {
    const saved = await run(() => callApi('teams/' + teamId + '/providers', 'POST', { name, baseUrl, apiKey }), t('providerAdded'));
    if (!saved) return;
    setConnected(name);
    await readModels(name);
  }

  async function publish() {
    const provider = connected!;
    const items: { id: string; name: string; contextWindow?: number; maxTokens?: number }[] = manual
      ? [{ id: typed.id.trim(), name: typed.name.trim() || typed.id.trim() }]
      : (listed ?? []).filter((m) => chosen.has(m.id));
    const names = new Set(published.map((m) => m.name));
    const ok = await run(async () => {
      for (const item of items) {
        // Names are unique per team; a second provider's model of the same name says whose it is.
        const label = names.has(item.name) ? `${item.name} (${provider})` : item.name;
        names.add(label);
        await callApi(`teams/${teamId}/configs`, 'POST', {
          kind: 'model',
          name: label,
          data: { provider, model: item.id, contextWindow: item.contextWindow, maxTokens: item.maxTokens },
        });
      }
    }, t('published', { count: items.length }));
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{connected ? t('chooseModels') : pick ? t('connect', { name: custom ? t('custom') : tc(pick) }) : t('addProvider')}</DialogTitle>
          <DialogDescription>{connected ? t('chooseModelsHint') : pick ? (custom ? t('customHint') : t('keyHint')) : t('pickHint')}</DialogDescription>
        </DialogHeader>

        {!pick && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROVIDER_CATALOG.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={taken.has(p.id)}
                  onClick={() => {
                    setPick(p.id);
                    setName(p.id);
                    setBaseUrl(p.baseUrl);
                  }}
                  className="flex w-full flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm hover:border-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Mark text={p.mark} />
                  <span className="font-medium">{tc(p.id)}</span>
                  {taken.has(p.id) && <span className="text-xs text-muted-foreground">{t('connected')}</span>}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => {
                  setPick('custom');
                  setName('');
                  setBaseUrl('');
                }}
                className="flex w-full flex-col items-start gap-2 rounded-lg border border-dashed p-3 text-left text-sm hover:border-ring"
              >
                <Mark text="+" />
                <span className="font-medium">{t('custom')}</span>
                <span className="text-xs text-muted-foreground">{t('customShort')}</span>
              </button>
            </li>
          </ul>
        )}

        {pick && !connected && (
          <form
            id="connect-provider"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            {custom && (
              <>
                <Field id="provider-name" label={t('providerName')} hint={t('providerNameHint')}>
                  <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="company-gateway" />
                </Field>
                <Field id="provider-url" label={t('baseUrl')}>
                  <Input id="provider-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required placeholder="https://llm.example.com/v1" />
                </Field>
              </>
            )}
            <Field id="provider-key" label={t('apiKey')} hint={t('apiKeyHint')}>
              <Input id="provider-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required autoFocus />
            </Field>
            {!custom && (
              <details className="rounded-md border px-3 py-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t('advanced')}</summary>
                <div className="mt-3 flex flex-col gap-4">
                  <Field id="provider-name" label={t('providerName')} hint={t('secondAccountHint')}>
                    <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
                  </Field>
                  <Field id="provider-url" label={t('baseUrl')}>
                    <Input id="provider-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
                  </Field>
                </div>
              </details>
            )}
          </form>
        )}

        {connected && listed === null && <p className="text-sm text-muted-foreground">{t('reading')}</p>}

        {connected && listed !== null && !manual && (
          listed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('allPublished')}</p>
          ) : (
            <ul className="flex max-h-80 flex-col overflow-y-auto rounded-md border">
              {listed.map((m) => (
                <li key={m.id} className="border-b last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(m.id);
                        else next.delete(m.id);
                        setChosen(next);
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{m.name}</span>
                      {m.name !== m.id && <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{m.id}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{tokens(m.contextWindow)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )
        )}

        {connected && manual && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('noList')}</p>
            <Field id="model-id" label={t('modelId')}>
              <Input id="model-id" value={typed.id} onChange={(e) => setTyped({ ...typed, id: e.target.value })} maxLength={100} required />
            </Field>
            <Field id="model-name" label={t('displayName')}>
              <Input id="model-name" value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value })} maxLength={100} placeholder={typed.id} />
            </Field>
          </div>
        )}

        <DialogFooter>
          {pick && !connected && !existing && (
            <Button variant="outline" onClick={() => setPick(null)}>
              {t('back')}
            </Button>
          )}
          {pick && !connected && (
            <Button type="submit" form="connect-provider" disabled={pending}>
              {t('connectSubmit')}
            </Button>
          )}
          {connected && listed !== null && (manual || listed.length > 0) && (
            <Button disabled={pending || (manual ? !typed.id.trim() : chosen.size === 0)} onClick={() => void publish()}>
              {t('publish', { count: manual ? 1 : chosen.size })}
            </Button>
          )}
          {connected && listed !== null && !manual && listed.length === 0 && <Button onClick={onClose}>{t('done')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move a provider or replace its key; the name stays, since team models refer to it. */
function RekeyDialog({ teamId, provider, onClose }: { teamId: string; provider: ProviderView; onClose: () => void }) {
  const t = useTranslations('team.models');
  const { pending, run } = useMutation();
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rekeyTitle', { name: provider.name })}</DialogTitle>
          <DialogDescription>{t('rekeyHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { baseUrl, ...(apiKey ? { apiKey } : {}) };
            if (await run(() => callApi(`teams/${teamId}/providers/${provider.id}`, 'PUT', body), t('providerSaved'))) onClose();
          }}
        >
          <Field id="rekey-url" label={t('baseUrl')}>
            <Input id="rekey-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          </Field>
          <Field id="rekey-key" label={t('apiKey')} hint={t('keepKeyHint')}>
            <Input id="rekey-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A team model's display name and limits; its provider and model id stay what they were published as. */
function EditModelDialog({ teamId, model, onClose }: { teamId: string; model: ModelConfig; onClose: () => void }) {
  const t = useTranslations('team.models');
  const { pending, run } = useMutation();
  const [name, setName] = useState(model.name);
  const [contextWindow, setContextWindow] = useState(String(model.data.contextWindow ?? ''));
  const [maxTokens, setMaxTokens] = useState(String(model.data.maxTokens ?? ''));
  const number = (value: string) => (value ? Number(value) : undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="text-left">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription className="font-mono">
            {model.data.provider} / {model.data.model}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              kind: 'model',
              name,
              data: { provider: model.data.provider, model: model.data.model, contextWindow: number(contextWindow), maxTokens: number(maxTokens) },
              version: model.version,
            };
            if (await run(() => callApi(`teams/${teamId}/configs/${model.id}`, 'PATCH', body), t('modelSaved'))) onClose();
          }}
        >
          <Field id="edit-name" label={t('displayName')}>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-context" label={t('context')}>
              <Input id="edit-context" type="number" min={1} value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
            </Field>
            <Field id="edit-max" label={t('maxOutput')} hint={t('limitsHint')}>
              <Input id="edit-max" type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
