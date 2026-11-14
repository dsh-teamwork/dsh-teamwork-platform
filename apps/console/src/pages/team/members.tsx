/**
 * A team's members page (`/teams/{teamId}/members`). An admin brings people in
 * one of two ways, decided by the instance (ADR 0006): an invitation link where
 * it sends email, or an account with a first password, shown once, where it
 * holds passwords. A member sees who is in the team and can leave it.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, type Invite } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type Reload = () => Promise<unknown>;

export function TeamMembersPage() {
  const { team, reload, passwords } = useTeam();
  const word = useTeamError();
  // Invitations exist only where the instance sends email; with passwords, an admin creates accounts instead.
  const listed = team.role === 'admin' && !passwords;
  const invites = useApi<Invite[]>(listed ? `teams/${team.id}/invites` : null);
  if (listed && !invites.data) return invites.error ? <Failure message={word(invites.error)} /> : null;
  return <Members invites={invites.data ?? []} reload={() => Promise.all([reload(), invites.reload()])} />;
}

function Members({ invites, reload }: { invites: Invite[]; reload: Reload }) {
  const { me, team, passwords } = useTeam();
  const t = useTranslations('team');
  const { pending, run } = useMutation(reload);
  const navigate = useNavigate();
  const admin = team.role === 'admin';
  const path = (rest: string) => `teams/${team.id}/${rest}`;
  // A first password is shown once, beside whose it is, and gone on reload.
  const [handover, setHandover] = useState<{ email: string; password: string | null } | null>(null);

  const leave = !admin && (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!confirm(t('leave.confirm'))) return;
        run(async () => {
          await api(path('membership'), { method: 'DELETE' });
          navigate('/teams');
        }, t('leave.done'));
      }}
    >
      {t('leave.submit')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('nav.members')}
        description={admin ? t(passwords ? 'members.descriptionPasswords' : 'members.descriptionInvites') : t('members.descriptionMember')}
        action={leave || undefined}
      />

      {admin && passwords && <AddMember teamId={team.id} reload={reload} onAdded={setHandover} />}
      {admin && !passwords && <Invitations teamId={team.id} reload={reload} invites={invites} />}
      {handover && <Handover {...handover} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t('members.person')}</th>
                <th className="w-0 px-4 py-2.5 font-medium whitespace-nowrap">{t('members.role')}</th>
                {admin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.userId} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="font-medium [overflow-wrap:anywhere]">{m.email}</span>
                    {m.userId === me && <span className="ml-2 text-xs text-muted-foreground">{t('members.you')}</span>}
                  </td>
                  <td className="w-0 px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                        m.role === 'admin' ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t(`role.${m.role}`)}
                    </span>
                  </td>
                  {admin && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {m.userId !== me && (
                        <>
                          {passwords && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                if (!confirm(t('members.resetConfirm'))) return;
                                run(async () => {
                                  const reset = await api<{ password: string }>(path(`members/${m.userId}/password`), { method: 'POST' });
                                  setHandover({ email: m.email ?? '', password: reset.password });
                                }, t('members.resetDone'));
                              }}
                            >
                              {t('members.reset')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              if (confirm(t('members.removeConfirm'))) run(() => api(path(`members/${m.userId}`), { method: 'DELETE' }), t('members.removed'));
                            }}
                          >
                            {t('members.remove')}
                          </Button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Where the instance holds passwords: an admin creates the account, or adds an existing one as it is. */
function AddMember({ teamId, reload, onAdded }: { teamId: string; reload: Reload; onAdded: (handover: { email: string; password: string | null }) => void }) {
  const t = useTranslations('team');
  const { pending, run } = useMutation(reload);
  const [email, setEmail] = useState('');
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const added = await api<{ email: string; password: string | null }>(`teams/${teamId}/members`, { body: { email } });
              onAdded({ email: added.email, password: added.password });
              setEmail('');
            }, t('members.added'));
          }}
        >
          <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 text-sm font-medium">
            {t('members.addEmail')}
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <Button type="submit" disabled={pending}>
            {t('members.addSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The first password, shown once beside whose it is; or a note that the account keeps its own. */
function Handover({ email, password }: { email: string; password: string | null }) {
  const t = useTranslations('team');
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-6 text-sm">
        {password ? (
          <>
            <span className="text-muted-foreground">{t('members.firstPassword', { email })}</span>
            <Input readOnly value={password} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          </>
        ) : (
          <span className="text-muted-foreground">{t('members.existing', { email })}</span>
        )}
      </CardContent>
    </Card>
  );
}

/** Where the instance sends email: single-use links, and the ones not used yet. */
function Invitations({ teamId, reload, invites }: { teamId: string; reload: Reload; invites: Invite[] }) {
  const t = useTranslations('team');
  const format = useFormatter();
  const { pending, run } = useMutation(reload);
  // The link just created, kept beside its invitation so revoking another one leaves it shown.
  const [created, setCreated] = useState<{ id: string; link: string } | null>(null);
  // Read once at mount: an invitation that expires while the page stays open goes on the next load.
  const [now] = useState(Date.now);
  const open = invites.filter((i) => !i.usedAt && Date.parse(i.expiresAt) > now);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('invites.title')}</CardTitle>
          <CardDescription>{t('invites.description')}</CardDescription>
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            run(async () => {
              const invite = await api<Invite & { token: string }>(`teams/${teamId}/invites`, { method: 'POST' });
              setCreated({ id: invite.id, link: `${location.origin}/teams?invite=${invite.token}` });
            }, t('invites.created'))
          }
        >
          {t('invites.create')}
        </Button>
      </CardHeader>
      {(created || open.length > 0) && (
        <CardContent className="flex flex-col gap-3 text-sm">
          {created && (
            <label className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">{t('invites.link')}</span>
              <Input readOnly value={created.link} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          {open.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 border-t pt-3">
              <span className="text-muted-foreground">
                {t('invites.expires', { at: format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await api(`teams/${teamId}/invites/${i.id}`, { method: 'DELETE' });
                    if (created?.id === i.id) setCreated(null);
                  }, t('invites.revoked'))
                }
              >
                {t('invites.revoke')}
              </Button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
