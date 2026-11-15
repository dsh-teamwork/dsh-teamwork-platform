import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Rate = Schemas['ModelRate'];
type RateInput = Schemas['ModelRateInput'];

export function ModelRateButton({ teamId, configId, name, admin }: { teamId: string; configId: string; name: string; admin: boolean }) {
  const t = useTranslations('usage');
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{t('rate')}</Button>
    {open && <RateDialog teamId={teamId} configId={configId} name={name} admin={admin} close={() => setOpen(false)} />}
  </>;
}

function RateDialog({ teamId, configId, name, admin, close }: { teamId: string; configId: string; name: string; admin: boolean; close: () => void }) {
  const t = useTranslations('usage');
  const word = useTeamError();
  const path = `teams/${teamId}/model-rates/${configId}`;
  const rate = useApi<Rate>(path);
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('rateTitle', { name })}</DialogTitle><DialogDescription>{t('rateHint')}</DialogDescription></DialogHeader>
      {!!rate.error && <p role="alert" className="text-sm text-destructive">{word(rate.error)}</p>}
      {rate.data && <RateForm key={rate.data.revision} value={rate.data} path={path} admin={admin} reload={rate.reload} close={close} />}
    </DialogContent>
  </Dialog>;
}

function RateForm({ value, path, admin, reload, close }: { value: Rate; path: string; admin: boolean; reload: () => Promise<unknown>; close: () => void }) {
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
    <DialogFooter><Button type="button" variant="outline" onClick={close}>{t('close')}</Button>{admin && <Button type="submit" disabled={pending}>{t('save')}</Button>}</DialogFooter>
  </form>;
}
