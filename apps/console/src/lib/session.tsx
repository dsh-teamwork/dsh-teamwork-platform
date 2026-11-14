import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, type Session } from './api';

interface SessionState {
  session: Session | null;
  /** Reads the session again, after signing in or out. */
  refresh: () => Promise<Session>;
}

const SessionContext = createContext<SessionState | null>(null);

/** Who is signed in, read once at start and again on `refresh`. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    const next = await api<Session>('auth/session');
    setSession(next);
    return next;
  }, []);
  useEffect(() => {
    api<Session>('auth/session').then(setSession, () => undefined);
  }, []);
  return <SessionContext.Provider value={{ session, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('useSession outside SessionProvider');
  return state;
}
