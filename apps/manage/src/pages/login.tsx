import { t } from '../lib/copy';
import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useAdmin, useTitle } from '../lib/session';
import { useApi } from '../lib/use-api';
import { api } from '../lib/api-client';
import { adminBase, adminPath, googleOnly } from '../lib/base';
import { BUTTON_SM, CONTROL, ErrorBanner } from '../components/console';

export function LoginPage() {
  useTitle(t('signIn'));
  const { who } = useAdmin();
  const [params] = useSearchParams();
  const { data, error } = useApi<{
    doors: { password: boolean; emailCode: boolean; google: boolean };
  }>('/api/auth/session');
  const [sent, setSent] = useState(false);
  const [change, setChange] = useState(false);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const requested = params.get('next');
  const next =
    requested &&
    requested.startsWith(adminBase + '/') &&
    !requested.startsWith('//') &&
    !requested.includes('\\')
      ? requested
      : adminPath();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFailure('');
    const f = new FormData(e.currentTarget);
    try {
      if (change) {
        await api.post('/api/auth/password/change', {
          current: String(f.get('current')),
          next: String(f.get('password')),
        });
        window.location.assign(next);
        return;
      }
      const email = String(f.get('email'));
      if (data?.doors.password) {
        const result = await api.post<{ mustChangePassword: boolean }>(
          '/api/auth/password/sign-in',
          { email, password: String(f.get('password')) },
        );
        if (result.mustChangePassword) {
          setChange(true);
          return;
        }
      } else if (!sent) {
        await api.post('/api/auth/email/send', { email });
        setSent(true);
        return;
      } else {
        await api.post('/api/auth/email/verify', {
          email,
          code: String(f.get('code')),
        });
      }
      window.location.assign(next);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : t('signInFailed'));
    } finally {
      setBusy(false);
    }
  }
  if (who.kind === 'admin')
    return <Navigate to={next.slice(adminBase.length) || '/'} replace />;
  if (who.kind === 'stranger') return <Navigate to="/denied" replace />;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5">
        <h1 className="text-xl font-semibold">{t('dshTeamworkAdmin')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('signInWithAnAccountOnTheInstanceAdministratorList')}
        </p>
        <ErrorBanner error={error} />
        {failure && (
          <p role="alert" className="text-destructive">
            {failure}
          </p>
        )}
        {data?.doors.google && (
          <a
            className={BUTTON_SM}
            href={'/api/auth/google?next=' + encodeURIComponent(next)}
          >
            {t('continueWithGoogle')}
          </a>
        )}
        {!googleOnly && data && (
          <form onSubmit={submit} className="space-y-4">
            {!change && (
              <label className="block">
                {t('email')}
                <input
                  className={CONTROL + ' w-full'}
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                />
              </label>
            )}
            {change && (
              <label className="block">
                {t('currentPassword')}
                <input
                  className={CONTROL + ' w-full'}
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
            )}
            {(data.doors.password || change) && (
              <label className="block">
                {change ? t('newPassword') : t('password')}
                <input
                  className={CONTROL + ' w-full'}
                  name="password"
                  type="password"
                  required
                  autoComplete={change ? 'new-password' : 'current-password'}
                />
              </label>
            )}
            {!data.doors.password && sent && !change && (
              <label className="block">
                {t('emailCode')}
                <input
                  className={CONTROL + ' w-full'}
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </label>
            )}
            <button className={BUTTON_SM} disabled={busy}>
              {change
                ? t('changePassword')
                : data.doors.password || sent
                  ? t('signIn')
                  : t('sendCode')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
