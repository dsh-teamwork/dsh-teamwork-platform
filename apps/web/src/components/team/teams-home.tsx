'use client';

/** `/teams`: the teams the person is in, and where they create a team or join one by invitation. */

import type { TeamSummary } from '@dsh-teamwork/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { callApi } from '@/lib/api-client';

import { ConsoleHeader } from './console-header';
import { useMutation } from './use-mutation';

/** An invitation is shared as a link; whoever pastes the whole link gets the token out of it. */
function tokenFrom(value: string): string {
  try {
    return new URL(value).searchParams.get('invite') ?? value;
  } catch {
    return value.trim();
  }
}

export function TeamsHome({ email, teams, invite, passwords }: { email: string; teams: TeamSummary[]; invite: string; passwords: boolean }) {
  const t = useTranslations('team');
  const { pending, run } = useMutation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [token, setToken] = useState(invite);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-10">
      <ConsoleHeader email={email} passwords={passwords} />
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          {teams.length === 0 && <CardDescription>{t('list.empty')}</CardDescription>}
        </CardHeader>
        {teams.length > 0 && (
          <CardContent>
            <ul className="flex flex-col divide-y">
              {teams.map((team) => (
                <li key={team.id}>
                  <Link href={`/teams/${team.id}`} className="flex items-center justify-between gap-4 py-3 hover:underline">
                    <span className="font-medium">{team.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`role.${team.role}`)} · {t('list.members', { count: team.memberCount })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
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
                  const created = await callApi<{ id: string }>('teams', 'POST', { name });
                  router.push(`/teams/${created.id}`);
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
                    const joined = await callApi<{ teamId: string }>('invites/redeem', 'POST', { token: tokenFrom(token) });
                    router.push(`/teams/${joined.teamId}`);
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
