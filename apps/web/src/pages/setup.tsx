import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Failure, useTitle } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authError, type AuthError } from '@/lib/auth-error';
import { useSession } from '@/lib/session';

const PASSWORD_MIN = 10;

/**
 * The instance's first account, open to whoever arrives while none exists:
 * the sign-in page sends the deployer here (ADR 0070).
 */
export function SetupPage() {
  const t = useTranslations('setup');
  const ts = useTranslations('signIn');
  const tp = useTranslations('password');
  const te = useTranslations('authErrors');
  useTitle(t('title'));
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);

  if (!session.doors.password || !session.setupOpen) return <CardPage title={t('title')} description={t('closed')} />;

  async function submit() {
    setError(null);
    setPending(true);
    try {
      await api('auth/setup', { body: { email, password } });
      await refresh();
      navigate('/teams', { replace: true });
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <CardPage title={t('title')} description={t('description')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor="email">{ts('email')}</Label>
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Label htmlFor="password">{ts('password')}</Label>
        <Input id="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">{tp('hint')}</p>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
        <Failure message={error && te(error)} />
      </form>
    </CardPage>
  );
}
