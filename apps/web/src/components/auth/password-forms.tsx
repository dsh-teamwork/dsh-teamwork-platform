'use client';

/**
 * The two forms of the password door (ADR 0006): claiming an instance's first
 * account with the link its server printed, and changing one's own password.
 * Each calls its action by name and words the `AuthError` it may answer with.
 */

import { PASSWORD_MIN, type AuthError, type AuthResult } from '@dsh-teamwork/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePassword, claimSetup } from '@/lib/auth/actions';

function useAction() {
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, startTransition] = useTransition();
  // A successful sign-in redirects, so a result is either a failure or a plain success.
  function run(action: () => Promise<AuthResult | void>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }
  return { error, pending, run };
}

function Failure({ error }: { error: AuthError | null }) {
  const te = useTranslations('authErrors');
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {te(error)}
    </p>
  );
}

export function SetupForm({ token }: { token: string }) {
  const t = useTranslations('setup');
  const ts = useTranslations('signIn');
  const tp = useTranslations('password');
  const { error, pending, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => claimSetup(token, email, password));
      }}
    >
      <Label htmlFor="email">{ts('email')}</Label>
      <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Label htmlFor="password">{ts('password')}</Label>
      <Input
        id="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{tp('hint')}</p>
      <Button type="submit" disabled={pending}>
        {t('submit')}
      </Button>
      <Failure error={error} />
    </form>
  );
}

export function ChangePasswordForm({ next }: { next: string }) {
  const t = useTranslations('password');
  const router = useRouter();
  const { error, pending, run } = useAction();
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => changePassword(current, replacement), () => router.push(next));
      }}
    >
      <Label htmlFor="current">{t('current')}</Label>
      <Input
        id="current"
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <Label htmlFor="next">{t('next')}</Label>
      <Input
        id="next"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN}
        required
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <Button type="submit" disabled={pending}>
        {t('submit')}
      </Button>
      <Failure error={error} />
    </form>
  );
}
