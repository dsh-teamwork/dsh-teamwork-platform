import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Failure } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authError, type AuthError } from '@/lib/auth-error';
import { returnPath } from '@/lib/return-path';
import { useSession } from '@/lib/session';

/**
 * Signing in. Where the instance sends no email it is an email and a
 * password (ADR 0006); the emailed code and Google arrive with phase 2 of
 * docs/tech/go-server.md.
 */
export function SignInPage() {
  const t = useTranslations('signIn');
  const te = useTranslations('authErrors');
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = returnPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);

  if (session.user) return <Navigate to={session.user.mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next} replace />;
  if (!session.doors.password) return <CardPage title={t('title')} description={te('unavailable')} />;

  async function submit() {
    setError(null);
    setPending(true);
    try {
      const { mustChangePassword } = await api<{ mustChangePassword: boolean }>('auth/password/sign-in', { body: { email, password } });
      await refresh();
      navigate(mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next, { replace: true });
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <CardPage title={t('title')} description={t('subtitlePassword')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" type="email" autoComplete="username" required placeholder={t('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Label htmlFor="password">{t('password')}</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={pending}>
          {t('verify')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('noAccount')}</p>
        <Failure message={error && te(error)} />
      </form>
    </CardPage>
  );
}
