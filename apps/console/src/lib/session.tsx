import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Loading } from '@/components/page';
import { Button } from '@/components/ui/button';

import { api, type Session } from './api';

interface SessionState {
  session: Session;
  /** Reads the session again, after signing in or out. */
  refresh: () => Promise<Session>;
  /** Ends the browser's session; a guarded page then sends the reader to sign in. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Who is signed in, read once at start and again on `refresh`. Nothing below
 * renders until it is known; a failure to read it is shown, with a retry,
 * rather than left spinning.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('authErrors');
  const tc = useTranslations('common');
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    const next = await api<Session>('auth/session');
    setSession(next);
    setFailed(false);
    return next;
  }, []);
  const load = useCallback(() => {
    api<Session>('auth/session').then(
      (next) => {
        setSession(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);
  // Signing out lands on the public home, as the Next app's did; the server
  // serves it, so this is a page load rather than a route.
  const signOut = useCallback(async () => {
    await api('auth/sign-out', { method: 'POST' });
    window.location.assign('/');
  }, []);

  if (failed && !session) {
    return (
      <CardPage title={tc('appName')} description={t('unavailable')}>
        <Button variant="outline" onClick={load}>
          {tc('retry')}
        </Button>
      </CardPage>
    );
  }
  if (!session) return <Loading />;
  return <SessionContext.Provider value={{ session, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('useSession outside SessionProvider');
  return state;
}

/**
 * The pages below it open only for someone signed in, past a password an
 * admin set and its owner has not changed yet; either detour comes back here.
 */
export function RequireUser() {
  const { session } = useSession();
  const location = useLocation();
  const here = encodeURIComponent(location.pathname + location.search);
  if (!session.user) return <Navigate to={`/sign-in?next=${here}`} replace />;
  if (session.user.mustChangePassword) return <Navigate to={`/password?next=${here}`} replace />;
  return <Outlet />;
}
