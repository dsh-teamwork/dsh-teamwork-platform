/** `/teams`: the teams the person is in, and where they create a team or join one by invitation. */

import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { LocalePicker } from '@/components/locale-picker';
import { Failure, useTitle } from '@/components/page';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type TeamSummary } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

/** An invitation is shared as a link; whoever pastes the whole link gets the token out of it. */
function tokenFrom(value: string): string {
  try {
    return new URL(value).searchParams.get('invite') ?? value;
  } catch {
    return value.trim();
  }
}

export function TeamsPage() {
  const { session } = useSession();
  const word = useTeamError();
  const [params] = useSearchParams();
  const teams = useApi<TeamSummary[]>('teams');
  useTitle(useTranslations('team.list')('title'));
  const email = session.user?.email ?? '';
  const passwords = session.doors.password;
  if (!teams.data) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-10">
        <ConsoleHeader email={email} passwords={passwords} />
        {teams.error ? <Failure message={word(teams.error)} /> : null}
      </main>
    );
  }
  return <TeamsHome email={email} teams={teams.data} invite={params.get('invite') ?? ''} passwords={passwords} reload={teams.reload} />;
}

function TeamsHome({
  email,
  teams,
  invite,
  passwords,
  reload,
}: {
  email: string;
  teams: TeamSummary[];
  invite: string;
  passwords: boolean;
  reload: () => Promise<unknown>;
}) {
  const t = useTranslations('team');
  const { pending, run } = useMutation(reload);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [token, setToken] = useState(invite);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-10">
      <ConsoleHeader email={email} passwords={passwords} />
      {teams.length === 0 && <p className="text-sm text-muted-foreground">{t('list.empty')}</p>}
      {(['admin', 'member'] as const).map((role) => {
        const group = teams.filter((team) => team.role === role);
        if (!group.length) return null;
        return (
          <section key={role} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">
              {t(`list.${role}`)} <span className="font-normal text-muted-foreground">{group.length}</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map((team) => (
                <li key={team.id}>
                  <Link
                    to={`/teams/${team.id}`}
                    className="flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-ring"
                  >
                    <img src="/logo.svg" alt="" width={36} height={36} className="shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{team.name}</span>
                      <span className="text-xs text-muted-foreground">{t('list.members', { count: team.memberCount })}</span>
                    </span>
                    <span className={role === 'admin' ? 'rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground' : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'}>
                      {t(`role.${role}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('create.title')}</CardTitle>
            <CardDescription>{t('create.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const created = await api<{ id: string }>('teams', { body: { name } });
                  navigate(`/teams/${created.id}`);
                }, t('create.done'));
              }}
            >
              <Label htmlFor="team-name">{t('create.name')}</Label>
              <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              <Button disabled={pending}>{t('create.submit')}</Button>
            </form>
          </CardContent>
        </Card>
        {/* Where the instance holds passwords, an admin adds people: there is no invitation to join by. */}
        {!passwords && (
          <Card>
            <CardHeader>
              <CardTitle>{t('join.title')}</CardTitle>
              <CardDescription>{t('join.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const joined = await api<{ teamId: string }>('invites/redeem', { body: { token: tokenFrom(token) } });
                    navigate(`/teams/${joined.teamId}`);
                  }, t('join.done'));
                }}
              >
                <Label htmlFor="invite-token">{t('join.token')}</Label>
                <Input id="invite-token" value={token} onChange={(e) => setToken(e.target.value)} required />
                <Button disabled={pending}>{t('join.submit')}</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

/** `passwords`: the instance holds passwords, so offer changing one's own. */
function ConsoleHeader({ email, passwords }: { email: string; passwords: boolean }) {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const tp = useTranslations('password');
  const { signOut } = useSession();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        {/* The public home is served by the server, not by this app's router. */}
        <a href="/" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {tc('appName')}
        </a>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{email}</span>
        {passwords && (
          <Link to="/password" className="underline-offset-4 hover:underline">
            {tp('change')}
          </Link>
        )}
        <LocalePicker />
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          {tc('signOut')}
        </Button>
      </div>
    </header>
  );
}
