import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { ModelMetadataLookup } from '@/components/team/model-metadata';
import { Field } from '@/components/team/field';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Schemas } from '@/lib/api';
import type { Reference } from '@/lib/model-metadata';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';

type Rate = Schemas['ModelRate'];
type RateInput = Schemas['ModelRateInput'];

/**
 * Sets a model's rate from its public reference (`lookupReference`), on the cost
 * basis, at the revision it has now. False when the model is not the team's to
 * price (an edition's own) or the write is refused; the admin then sets it by hand.
 */
export async function saveReferenceRates(teamId: string, configId: string, rates: NonNullable<Reference['rates']>): Promise<boolean> {
  const path = `teams/${teamId}/model-rates/${configId}`;
  try {
    const current = await api<Rate>(path);
    if (current.readOnly) return false;
    await api(path, { method: 'PUT', body: { revision: current.revision, basis: 'cost', ...rates } satisfies RateInput });
    return true;
  } catch {
    return false;
  }
}

/** A model's rate. `missing` says no call reaches the model until one is set (ADR 0050), and makes setting it the row's lead action. */
export function ModelRateButton({ teamId, configId, name, admin, provider, model, missing = false }: { teamId: string; configId: string; name: string; admin: boolean; provider: string; model: string; missing?: boolean }) {
  const t = useTranslations('usage');
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant={missing ? 'outline' : 'ghost'} onClick={() => setOpen(true)}>{t(missing ? 'setRate' : 'rate')}</Button>
    {open && <RateDialog teamId={teamId} configId={configId} name={name} admin={admin} provider={provider} model={model} close={() => setOpen(false)} />}
  </>;
}

function RateDialog({ teamId, configId, name, admin, provider, model, close }: { teamId: string; configId: string; name: string; admin: boolean; provider: string; model: string; close: () => void }) {
  const t = useTranslations('usage');
  const word = useTeamError();
  const path = `teams/${teamId}/model-rates/${configId}`;
  const rate = useApi<Rate>(path);
  // A saved rate can let calls through again, which the team's summary lists.
  const { reloadTeamSummary } = useTeam();
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('rateTitle', { name })}</DialogTitle><DialogDescription>{t(rate.data?.readOnly ? 'hostedRateHint' : 'rateHint')}</DialogDescription></DialogHeader>
      {!!rate.error && <p role="alert" className="text-sm text-destructive">{word(rate.error)}</p>}
      {rate.data && <RateForm key={rate.data.revision} value={rate.data} path={path} teamId={teamId} provider={provider} model={model} admin={admin && !rate.data.readOnly} reload={() => Promise.all([rate.reload(), reloadTeamSummary()])} close={close} />}
    </DialogContent>
  </Dialog>;
}

function RateForm({ value, path, admin, reload, close, teamId, provider, model }: { value: Rate; path: string; admin: boolean; reload: () => Promise<unknown>; close: () => void; teamId: string; provider: string; model: string }) {
  const t = useTranslations('usage');
  const [form, setForm] = useState<RateInput>({ revision: value.revision, basis: value.basis, input: value.input, cacheRead: value.cacheRead, cacheWrite: value.cacheWrite || '0', output: value.output });
  const { pending, run } = useMutation(reload);
  return <form className="flex flex-col gap-4" onSubmit={(e) => {
    e.preventDefault();
    if (admin) void run(() => api(path, { method: 'PUT', body: form }), t('saved')).then((ok) => { if (ok) close(); });
  }}>
    {!value.configured && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t('unpricedHint')}</p>}
    <div className="grid grid-cols-2 gap-4">
      {(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map((key) => <Field key={key} id={`rate-${key}`} label={t(`prices.${key}`)}>
        <Input id={`rate-${key}`} inputMode="decimal" maxLength={24} required disabled={!admin || pending} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      </Field>)}
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" disabled={!admin || pending} checked={form.basis === 'weight'} onChange={(e) => setForm({ ...form, basis: e.target.checked ? 'weight' : 'cost' })} />
      <span>{t('weightHint')}</span>
    </label>
    {/* Suggestions are supplier costs, so they are offered only while the basis is cost: applying them never switches a weight basis unseen. */}
    {admin && form.basis === 'cost' && <ModelMetadataLookup teamId={teamId} provider={provider} model={model} pricing auto={!value.configured} current={{ input: form.input, output: form.output, cacheRead: form.cacheRead, cacheWrite: form.cacheWrite }} disabled={pending} apply={(rates) => setForm((current) => ({ ...current, ...rates }))} />}
    <DialogFooter><Button type="button" variant="outline" onClick={close}>{t('close')}</Button>{admin && <Button type="submit" disabled={pending}>{t('save')}</Button>}</DialogFooter>
  </form>;
}
