import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

import { CardPage, Loading } from '@/components/page';
import { Button } from '@/components/ui/button';

import { api, type Session } from './api';

interface SessionState {
  session: Session;
  /** Reads the session again, after signing in or out. */
  refresh: () => Promise<Session>;
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
  return <SessionContext.Provider value={{ session, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('useSession outside SessionProvider');
  return state;
}
