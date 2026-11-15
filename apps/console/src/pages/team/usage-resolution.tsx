import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useMutation } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, type Schemas } from '@/lib/api';

export function UsageResolution({ teamId, entry, reload, close }: { teamId: string; entry: Schemas['UsageEntry']; reload: () => Promise<unknown>; close: () => void }) {
  const t = useTranslations('usage');
  const review = entry.code === 'usage_bound_exceeded';
  const [reason, setReason] = useState('');
  const [points, setPoints] = useState('');
  const [tokens, setTokens] = useState({ input: entry.input ?? 0, cacheRead: entry.cacheRead ?? 0, cacheWrite: entry.cacheWrite ?? 0, output: entry.output ?? 0, reasoning: entry.reasoning ?? 0 });
  const { pending, run } = useMutation(reload);
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) close(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t(review ? 'reviewRoute' : 'resolve')}</DialogTitle><DialogDescription>{t(review ? 'reviewHint' : 'resolveHint')}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={(event) => {
      event.preventDefault();
      const body: Schemas['UsageResolution'] = { reason, tokens, points: points || null };
      void run(() => api(`teams/${teamId}/usage/${entry.id}/resolve`, { method: 'POST', body }), t('resolved')).then((ok) => { if (ok) close(); });
    }}>
      <p className="text-sm font-medium">{entry.model}</p>
      {!review && <>
        <div className="grid grid-cols-2 gap-3">
          {(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'] as const).map((key) => <Field key={key} id={`resolve-${key}`} label={t(key)}><Input id={`resolve-${key}`} type="number" required min={0} max={1000000000} step={1} disabled={pending} value={tokens[key]} onChange={(e) => setTokens({ ...tokens, [key]: Number(e.target.value) })} /></Field>)}
        </div>
        <Field id="resolve-points" label={t('resolvedPoints')} hint={t('resolvedPointsHint')}><Input id="resolve-points" inputMode="decimal" maxLength={24} disabled={pending} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
      </>}
      <Field id="resolve-reason" label={t('reason')} hint={t('reasonHint')}><Textarea id="resolve-reason" required minLength={8} maxLength={500} disabled={pending} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>{t('close')}</Button><Button type="submit" disabled={pending}>{t('confirmResolve')}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
