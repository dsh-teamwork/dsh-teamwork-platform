import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';

import { Choice } from '@/components/team/choice';
import { PageHeader } from '@/components/team/console-shell';
import { Field } from '@/components/team/field';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Provider, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';

type Policy = Schemas['BudgetPolicy'];
type PolicyInput = Schemas['BudgetPolicyInput'];
type Window = Schemas['BudgetWindow'];
type Budgets = { policies: Policy[]; windows: Window[] };

export function TeamBudgetsPage() {
  const { team, me, reloadSummary } = useTeam();
  const t = useTranslations('budgets');
  const word = useTeamError();
  const format = useFormatter();
  const admin = team.role === 'admin';
  const data = useApi<Budgets>(`teams/${team.id}/budgets`);
  const providers = useApi<Provider[]>(admin ? `teams/${team.id}/providers` : null);
  const notices = useApi<Schemas['BudgetNotice'][]>(`teams/${team.id}/budgets/notices`);
  const resend = useMutation(() => Promise.all([notices.reload(), reloadSummary()]));
  const windows = data.data?.windows ?? [];
  const [editing, setEditing] = useState<Policy | 'new' | null>(null);
  const names = new Map(team.members.map((m) => [m.userId, m.email || m.userId]));
  return (
    <>
      <PageHeader title={t('title')} description={t(admin ? 'descriptionAdmin' : 'descriptionMember')} action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void Promise.all([data.reload(), notices.reload()])}><RefreshCw />{t('refresh')}</Button>
          {admin && <Button onClick={() => setEditing('new')}><Plus />{t('add')}</Button>}
        </div>
      } />
      {!!data.error && <p role="alert" className="text-sm text-destructive">{word(data.error)}</p>}
      {!data.data ? !data.error && <p className="text-sm text-muted-foreground">{t('loading')}</p> : data.data.policies.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t(admin ? 'emptyAdmin' : 'emptyMember')}</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.data.policies.map((policy) => {
            const scope = policy.scope === 'default_member' ? 'member' : policy.scope;
            const subject = policy.scope === 'default_member' ? me : policy.subjectId;
            const window = windows.find((w) => w.scope === scope && w.subjectId === subject && w.period === policy.period);
            const defaultForAll = admin && policy.scope === 'default_member';
            return <Card key={policy.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t(`scopes.${policy.scope}`)}{policy.subjectId && ` · ${names.get(policy.subjectId) ?? policy.subjectId}`}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`periods.${policy.period}`)} · {policy.activeTimezone}</p>
                </div>
                {admin && <Button variant="ghost" size="sm" onClick={() => setEditing(policy)}>{t('edit')}</Button>}
              </div>
              {policy.inheritsDefault ? <p className="text-sm text-muted-foreground">{t('inherits')}</p> : !policy.enabled ? <p className="text-sm text-muted-foreground">{t('disabled')}</p> : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div><dt className="text-muted-foreground">{t('pointLimit')}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{policy.points ?? t('notLimited')}</dd></div>
                  <div><dt className="text-muted-foreground">{t('usedAndReserved')}</dt><dd className="mt-1 tabular-nums">{defaultForAll ? t('perMember') : `${window?.spent ?? '0'} / ${window?.reserved ?? '0'}`}</dd></div>
                  {!defaultForAll && policy.points !== null && <div><dt className="text-muted-foreground">{t('remaining')}</dt><dd className="mt-1 font-semibold tabular-nums">{window ? window.remaining ?? '—' : policy.points}</dd></div>}
                  {policy.input !== null && <div><dt className="text-muted-foreground">{t('inputLimit')}</dt><dd>{policy.input.toLocaleString()}</dd></div>}
                  {policy.output !== null && <div><dt className="text-muted-foreground">{t('outputLimit')}</dt><dd>{policy.output.toLocaleString()}</dd></div>}
                  {policy.total !== null && <div><dt className="text-muted-foreground">{t('totalLimit')}</dt><dd>{policy.total.toLocaleString()}</dd></div>}
                </dl>
              )}
              {!defaultForAll && window && <WindowStatus window={window} />}
              {policy.effectiveAt && <p className="text-xs text-muted-foreground">{t('timezonePending', { zone: policy.timezone, at: format.dateTime(new Date(policy.effectiveAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
            </Card>;
          })}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{t('rules')}</p>
      {admin && windows.some((w) => w.scope === 'member') && <Card className="overflow-hidden">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">{t('memberUsage')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('memberUsageHint')}</p></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="bg-muted text-xs text-muted-foreground"><tr>{(['member', 'period', 'spent', 'reserved', 'remaining', 'resetColumn'] as const).map((key) => <th key={key} className="px-4 py-3 font-medium">{t(key)}</th>)}</tr></thead>
          <tbody>{windows.filter((w) => w.scope === 'member').map((w) => <tr key={w.id} className="border-t">
            <td className="px-4 py-3">{names.get(w.subjectId) ?? t('formerMember')}</td><td className="px-4 py-3">{t(`periods.${w.period}`)}</td>
            <td className="px-4 py-3 tabular-nums">{w.spent}</td><td className="px-4 py-3 tabular-nums">{w.reserved}</td><td className="px-4 py-3 tabular-nums">{w.pointLimit === null ? t('notLimited') : w.remaining ?? '—'}</td>
            <td className="px-4 py-3 text-muted-foreground">{format.dateTime(new Date(w.endsAt), { dateStyle: 'medium', timeStyle: 'short' })}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>}
      {!!notices.error && <p role="alert" className="text-sm text-destructive">{word(notices.error)}</p>}
      {!!notices.data?.length && <Card className="overflow-hidden">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">{t('notices')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('noticeHint')}</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><tbody>
          {notices.data.map((notice) => <tr key={notice.id} className="border-b last:border-0">
            <td className="px-4 py-3">{names.get(notice.recipientId) ?? t('formerMember')}</td>
            <td className="px-4 py-3 tabular-nums">{notice.threshold}%</td>
            <td className="px-4 py-3">{t(`noticeStates.${notice.state}`)}</td>
            <td className="px-4 py-3 text-right">{admin && notice.state === 'failed' && <Button size="sm" variant="ghost" disabled={resend.pending} onClick={() => void resend.run(() => api(`teams/${team.id}/budgets/notices/${notice.id}/retry`, { method: 'POST', body: {} }), t('retryQueued'))}>{t('retry')}</Button>}</td>
          </tr>)}
        </tbody></table></div>
      </Card>}
      {admin && editing && <BudgetDialog key={editing === 'new' ? 'new' : editing.id} current={editing === 'new' ? null : editing} policies={data.data?.policies ?? []} providers={providers.data ?? []} reload={() => Promise.all([data.reload(), reloadSummary()])} close={() => setEditing(null)} />}
    </>
  );
}

function WindowStatus({ window }: { window: Window }) {
  const t = useTranslations('budgets');
  const format = useFormatter();
  return <div className="border-t pt-3 text-xs text-muted-foreground">
    <p>{t('reset', { at: format.dateTime(new Date(window.endsAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
    {(window.unpriced > 0 || window.unbounded > 0) && <p className="mt-2 text-foreground">{t('unknownUsage')}</p>}
  </div>;
}

function BudgetDialog({ current, policies, providers, reload, close }: {
  current: Policy | null;
  policies: Policy[];
  providers: Provider[];
  reload: () => Promise<unknown>;
  close: () => void;
}) {
  const { team } = useTeam();
  const t = useTranslations('budgets');
  const [scope, setScope] = useState<PolicyInput['scope']>(current?.scope ?? 'team');
  const [subjectId, setSubject] = useState(current?.subjectId ?? '');
  const [period, setPeriod] = useState<PolicyInput['period']>(current?.period ?? 'month');
  const [timezone, setTimezone] = useState(() => current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [notify, setNotify] = useState<PolicyInput['notify']>(current?.notify ?? 'admins');
  const [memberMode, setMemberMode] = useState(current?.inheritsDefault ? 'inherit' : current && !current.enabled ? 'unlimited' : 'limited');
  const [points, setPoints] = useState(current?.points ?? '');
  const [input, setInput] = useState(current?.input?.toString() ?? '');
  const [output, setOutput] = useState(current?.output?.toString() ?? '');
  const [total, setTotal] = useState(current?.total?.toString() ?? '');
  const { pending, run } = useMutation(reload);
  const previous = policies.find((p) => p.scope === scope && p.subjectId === subjectId && p.period === period);
  const base: PolicyInput = { scope, subjectId, period, timezone, enabled, notify, revision: current?.revision ?? 0, points: points || null, input: input ? Number(input) : null, output: output ? Number(output) : null, total: total ? Number(total) : null };
  if (scope === 'member') {
    base.enabled = memberMode === 'limited';
    if (memberMode !== 'limited') {
      base.points = memberMode === 'unlimited' ? '0' : null;
      base.input = base.output = base.total = null;
    }
  }
  const save = (value: PolicyInput) => run(() => api(`teams/${team.id}/budgets`, { method: 'PUT', body: value }), t('saved')).then((ok) => { if (ok) close(); });
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) close(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t(current ? 'edit' : 'add')}</DialogTitle><DialogDescription>{t('formHint')}</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(base); }}>
      <div className="grid grid-cols-2 gap-4">
        <Field id="budget-scope" label={t('scope')}><Choice id="budget-scope" label={t('scope')} disabled={pending || !!current} value={scope} options={(['team', 'default_member', 'member', 'provider'] as const).map((value) => ({ value, label: t(`scopes.${value}`) }))} change={(value) => { setScope(value as PolicyInput['scope']); setSubject(''); setNotify(value === 'member' || value === 'default_member' ? 'both' : 'admins'); }} /></Field>
        <Field id="budget-period" label={t('period')}><Choice id="budget-period" label={t('period')} disabled={pending || !!current} value={period} options={(['day', 'month'] as const).map((value) => ({ value, label: t(`periods.${value}`) }))} change={(value) => setPeriod(value as PolicyInput['period'])} /></Field>
      </div>
      {scope === 'member' && <Field id="budget-member" label={t('member')}><Choice id="budget-member" label={t('member')} disabled={pending || !!current} value={subjectId} options={team.members.map((m) => ({ value: m.userId, label: m.email || m.userId }))} change={setSubject} /></Field>}
      {scope === 'provider' && <Field id="budget-provider" label={t('provider')}><Choice id="budget-provider" label={t('provider')} disabled={pending || !!current} value={subjectId} options={providers.map((p) => ({ value: p.name, label: p.name }))} change={setSubject} /></Field>}
      {scope === 'member' && <Field id="budget-member-mode" label={t('memberMode')}><Choice id="budget-member-mode" label={t('memberMode')} disabled={pending} value={memberMode} options={['limited', 'unlimited', 'inherit'].map((value) => ({ value, label: t(`memberModes.${value}`) }))} change={setMemberMode} /></Field>}
      {(scope !== 'member' || memberMode === 'limited') && <>
      <Field id="budget-points" label={t('pointLimit')} hint={t('blankUnlimited')}><Input id="budget-points" inputMode="decimal" maxLength={24} disabled={pending} value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
      <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer">{t('tokenLimits')}</summary><div className="mt-3 grid grid-cols-3 gap-3">
        {([{ key: 'input', value: input, set: setInput }, { key: 'output', value: output, set: setOutput }, { key: 'total', value: total, set: setTotal }] as const).map((field) => <Field key={field.key} id={`budget-${field.key}`} label={t(`${field.key}Limit`)}><Input id={`budget-${field.key}`} type="number" min={0} max={1000000000000} step={1} disabled={pending} value={field.value} onChange={(e) => field.set(e.target.value)} /></Field>)}
      </div></details>
      </>}
      <Field id="budget-timezone" label={t('timezone')} hint={t('timezoneHint')}><Input id="budget-timezone" required maxLength={100} disabled={pending} value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
      <Field id="budget-notify" label={t('notify')}><Choice id="budget-notify" label={t('notify')} disabled={pending || !base.enabled} value={notify} options={(['admins', 'both', 'owner', 'none'] as const).filter((value) => scope === 'member' || scope === 'default_member' || value === 'admins' || value === 'none').map((value) => ({ value, label: t(`notifyChoices.${value}`) }))} change={(value) => setNotify(value as PolicyInput['notify'])} /></Field>
      {scope !== 'member' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => setEnabled(e.target.checked)} />{t('enabled')}</label>}
      {previous && !current && <p className="text-xs text-muted-foreground">{t('exists')}</p>}
      <DialogFooter>
        {current?.scope === 'member' && <Button type="button" variant="ghost" disabled={pending} onClick={() => void save({ ...base, enabled: false, points: null, input: null, output: null, total: null })}>{t('restoreDefault')}</Button>}
        <Button type="button" variant="outline" disabled={pending} onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={pending || !!previous && !current || (scope === 'member' || scope === 'provider') && !subjectId}>{t('save')}</Button>
      </DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
