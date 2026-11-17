import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Failure, useTitle } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type TeamSummary } from '@/lib/api';
import { authError, type AuthError } from '@/lib/auth-error';
import { returnPath } from '@/lib/return-path';
import { useSession } from '@/lib/session';

const PASSWORD_MIN = 10;

/** Changing one's own password; where an admin set it, nothing else opens until it is changed. */
export function PasswordPage() {
  const t = useTranslations('password');
  const te = useTranslations('authErrors');
  useTitle(t('title'));
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = returnPath(params.get('next'));
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);

  if (!session.user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!session.doors.password) return <Navigate to={next} replace />;
  // The session signed in with the admin-set password just now, so it is not asked for it again (auth.FirstPasswordProven).
  const proven = session.user.changeWithoutCurrent;

  // Bound for the list of teams (the default), someone in exactly one team goes straight to it instead.
  async function onlyTeam(): Promise<string> {
    const teams = await api<TeamSummary[]>('teams').catch(() => []);
    return teams.length === 1 ? `/teams/${encodeURIComponent(teams[0].id)}` : '/teams';
  }

  async function submit() {
    setError(null);
    setPending(true);
    try {
      await api('auth/password/change', { body: { ...(proven ? {} : { current }), next: replacement } });
      await refresh();
      navigate(next === '/teams' ? await onlyTeam() : next, { replace: true });
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <CardPage title={t('title')} description={session.user.mustChangePassword ? t('mustChange') : undefined}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!proven && (
          <>
            <Label htmlFor="current">{t('current')}</Label>
            <Input id="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </>
        )}
        <Label htmlFor="next">{t('next')}</Label>
        <Input id="next" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
        <Failure message={error && te(error)} />
      </form>
    </CardPage>
  );
}
