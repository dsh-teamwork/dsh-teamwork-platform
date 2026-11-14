import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Failure, useTitle } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { AUTH_ERRORS, authError, type AuthError } from '@/lib/auth-error';
import { returnPath } from '@/lib/return-path';
import { useSession } from '@/lib/session';

/** An `?error=` a sign-in round trip came back with; anything not ours reads as `unavailable`. */
function fromQuery(value: string | null): AuthError | null {
  if (!value) return null;
  return (AUTH_ERRORS as readonly string[]).includes(value) ? (value as AuthError) : 'unavailable';
}

/**
 * Signing in: Google where it is configured, and one email door — an emailed
 * code where the instance sends email, a password where it does not (ADR 0006).
 */
export function SignInPage() {
  const t = useTranslations('signIn');
  const te = useTranslations('authErrors');
  useTitle(t('title'));
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = returnPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<AuthError | null>(fromQuery(params.get('error')));
  const [pending, setPending] = useState(false);

  if (session.user) return <Navigate to={session.user.mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next} replace />;
  const { doors } = session;

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  async function signedIn(mustChangePassword = false) {
    await refresh();
    navigate(mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next, { replace: true });
  }

  const subtitle = doors.password ? (doors.google ? 'subtitlePasswordGoogle' : 'subtitlePassword') : doors.google ? 'subtitle' : 'subtitleEmailOnly';
  return (
    <CardPage title={t('title')} description={t(subtitle)}>
      <div className="flex flex-col gap-4">
        {doors.google && (
          <>
            <Button variant="outline" disabled={pending} onClick={() => window.location.assign(`/api/auth/google?next=${encodeURIComponent(next)}`)}>
              {t('google')}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('or')}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        {doors.password ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const { mustChangePassword } = await api<{ mustChangePassword: boolean }>('auth/password/sign-in', { body: { email, password } });
                await signedIn(mustChangePassword);
              });
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
          </form>
        ) : doors.emailCode && !codeSent ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api('auth/email/send', { body: { email } });
                setCodeSent(true);
              });
            }}
          >
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" type="email" autoComplete="email" required placeholder={t('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" disabled={pending}>
              {t('sendCode')}
            </Button>
          </form>
        ) : doors.emailCode ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api('auth/email/verify', { body: { email, code } });
                await signedIn();
              });
            }}
          >
            <p className="text-sm text-muted-foreground">{t('codeSent', { email })}</p>
            <Label htmlFor="code">{t('code')}</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" disabled={pending}>
              {t('verify')}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setCodeSent(false);
                setCode('');
              }}
            >
              {t('useAnotherEmail')}
            </Button>
          </form>
        ) : null}

        <Failure message={error && te(error)} />
      </div>
    </CardPage>
  );
}
