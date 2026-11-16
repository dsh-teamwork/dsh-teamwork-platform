import { t } from './copy';
import { adminPath } from './base';
/**
 * Who the console is for. `GET /api/admin/me` answers an admin's address, 401
 * without a Google session and 403 for a Google session that is not on
 * ADMIN_EMAILS; the server re-checks the list on every request, so this only
 * chooses which page to show.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { toast } from 'sonner';

type Who =
  | { kind: 'loading' }
  | { kind: 'admin'; email: string }
  | { kind: 'stranger'; email: string }
  | { kind: 'nobody' };

const Context = createContext<{
  who: Who;
  signOut: () => Promise<void>;
} | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    fetch('/api/admin/me', { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { email?: string };
        if (!live) return;
        if (res.ok && body.email) setWho({ kind: 'admin', email: body.email });
        else if (res.status === 403 && body.email)
          setWho({ kind: 'stranger', email: body.email });
        else if (res.status === 401) setWho({ kind: 'nobody' });
        else throw new Error(`me ${res.status}`);
      })
      .catch(() => {
        if (live) toast.error(t('couldNotReachTheServerReloadToTryAgain'));
      });
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    const res = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('couldNotSignOutTryAgain'));
      return;
    }
    window.location.assign(adminPath('/login'));
  }, []);

  return (
    <Context.Provider value={{ who, signOut }}>{children}</Context.Provider>
  );
}

export function useAdmin() {
  const value = useContext(Context);
  if (!value) throw new Error('useAdmin outside AdminProvider');
  return value;
}

/** Every page but sign-in and denied: an admin, or the page that says why not. */
export function RequireAdmin() {
  const { who } = useAdmin();
  const location = useLocation();
  if (who.kind === 'loading') return null;
  if (who.kind === 'nobody') {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(adminPath(`${location.pathname}${location.search}`))}`}
        replace
      />
    );
  }
  if (who.kind === 'stranger') return <Navigate to="/denied" replace />;
  return <Outlet />;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · DSH Teamwork Admin`;
  }, [title]);
}
