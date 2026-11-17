/**
 * A team's shared DSHs (`/teams/{teamId}/shared-hosts`, docs/tech/shared-dsh.md):
 * the team host keys an admin creates, rotates and deletes. A key is shown once,
 * when it is created or rotated, as the command to run in that DSH; the server
 * keeps only its HMAC. A member sees that only an admin manages them.
 */

import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';

import { CopyButton } from '@/components/copy-button';
import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, type Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';

type SharedHost = Schemas['SharedHost'];
type Issued = Schemas['SharedHostKey'];

export function TeamSharedHostsPage() {
  const { team } = useTeam();
  const t = useTranslations('team.sharedHosts');
  const word = useTeamError();
  const admin = team.role === 'admin';
  const root = `teams/${team.id}/shared-hosts`;
  const hosts = useApi<{ hosts: SharedHost[] }>(admin ? root : null);
  const { pending, run } = useMutation(hosts.reload);
  const format = useFormatter();
  const [name, setName] = useState('');
  // The key just issued, shown until the page is left or another is issued.
  const [issued, setIssued] = useState<Issued | null>(null);
  // The host whose access is being edited, and the draft of it.
  const [editing, setEditing] = useState<{ id: string; access: 'team' | 'listed'; userIds: string[] } | null>(null);
  const when = (at: string | null) => (at ? format.dateTime(new Date(at), { dateStyle: 'medium', timeStyle: 'short' }) : t('never'));
  const command = issued ? `/teamwork share enable ${issued.key}` : '';

  if (!admin) return <><PageHeader title={t('title')} description={t('description')} /><p className="text-sm text-muted-foreground">{t('adminOnly')}</p></>;
  if (!hosts.data) return hosts.error ? <Failure message={word(hosts.error)} /> : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {issued && (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>{t('keyTitle', { name: issued.host.name })}</CardTitle>
            <CardDescription>{t('keyOnce')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 text-xs break-all">{command}</code>
              <CopyButton text={command} />
            </div>
            <p className="text-xs text-muted-foreground">{t('keyHelp')}</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setIssued(await api<Issued>(root, { body: { name: name.trim() } }));
                setName('');
              }, t('created'));
            }}
          >
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
              {t('name')}
              <Input value={name} maxLength={100} required placeholder={t('namePlaceholder')} onChange={(event) => setName(event.target.value)} />
            </label>
            <Button type="submit" disabled={pending || !name.trim()}>{t('create')}</Button>
          </form>
        </CardContent>
      </Card>
      {hosts.data.hosts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>{(['name', 'access', 'machine', 'lastSeen', 'actions'] as const).map((key) => <th key={key} className="px-4 py-3 font-medium">{t(key)}</th>)}</tr>
              </thead>
              <tbody>
                {hosts.data.hosts.map((host) => (
                  <tr key={host.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 font-medium">{host.name}</td>
                    <td className="px-4 py-3">{host.access === 'team' ? t('accessTeam') : t('accessListed', { count: host.memberIds.length })}</td>
                    <td className="px-4 py-3">{host.bound ? t('bound', { at: when(host.boundAt) }) : t('unbound')}</td>
                    <td className="px-4 py-3">{when(host.lastSeenAt)}</td>
                    <td className="flex gap-2 px-4 py-3">
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing({ id: host.id, access: host.access, userIds: host.memberIds })}>
                        {t('editAccess')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(t('rotateConfirm'))) void run(async () => setIssued(await api<Issued>(`${root}/${host.id}/rotate`, { body: {} })), t('rotated'));
                        }}
                      >
                        {t('rotate')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(t('deleteConfirm'))) return;
                          void run(async () => {
                            await api(`${root}/${host.id}`, { method: 'DELETE' });
                            if (issued?.host.id === host.id) setIssued(null);
                          }, t('deleted'));
                        }}
                      >
                        {t('delete')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{t('accessTitle', { name: hosts.data.hosts.find((h) => h.id === editing.id)?.name ?? '' })}</CardTitle>
            <CardDescription>{t('accessHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {(['team', 'listed'] as const).map((access) => (
              <label key={access} className="flex items-center gap-2">
                <input type="radio" name="access" checked={editing.access === access} onChange={() => setEditing({ ...editing, access })} />
                {access === 'team' ? t('accessTeam') : t('accessListedOption')}
              </label>
            ))}
            {editing.access === 'listed' && (
              <div className="flex flex-col gap-2 pl-6">
                {team.members.map((m) => (
                  <label key={m.userId} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editing.userIds.includes(m.userId)}
                      onChange={(event) => setEditing({ ...editing, userIds: event.target.checked ? [...editing.userIds, m.userId] : editing.userIds.filter((id) => id !== m.userId) })}
                    />
                    {m.email ?? m.userId}
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api(`${root}/${editing.id}/members`, { method: 'PUT', body: { access: editing.access, userIds: editing.access === 'listed' ? editing.userIds : [] } });
                    setEditing(null);
                  }, t('accessSaved'))
                }
              >
                {t('save')}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>{t('cancel')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
