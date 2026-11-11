'use client';

import { useTranslations } from 'next-intl';
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

export function NoTeam({ email, invite }: { email: string; invite: string }) {
  const t = useTranslations('team');
  const { pending, run } = useMutation();
  const [name, setName] = useState('');
  const [token, setToken] = useState(invite);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-10">
      <ConsoleHeader email={email} />
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
                run(() => callApi('teams', 'POST', { name }), t('create.done'));
              }}
            >
              <Label htmlFor="team-name">{t('create.name')}</Label>
              <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              <Button disabled={pending}>{t('create.submit')}</Button>
            </form>
          </CardContent>
        </Card>
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
                run(() => callApi('invites/redeem', 'POST', { token: tokenFrom(token) }), t('join.done'));
              }}
            >
              <Label htmlFor="invite-token">{t('join.token')}</Label>
              <Input id="invite-token" value={token} onChange={(e) => setToken(e.target.value)} required />
              <Button disabled={pending}>{t('join.submit')}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
