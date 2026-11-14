import { Navigate, useLocation, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Loading } from '@/components/page';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Where signing in lands. The team console itself is phase 3 of
 * docs/tech/go-server.md; until then this says who is signed in.
 */
export function TeamsPage() {
  const t = useTranslations('common');
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  if (!session) return <Loading />;
  if (!session.user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (session.user.mustChangePassword) return <Navigate to={`/password?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <CardPage title={t('appName')} description={session.user.email ?? undefined}>
      <Button
        variant="outline"
        onClick={async () => {
          await api('auth/sign-out', { method: 'POST' });
          await refresh();
          navigate('/sign-in', { replace: true });
        }}
      >
        {t('signOut')}
      </Button>
    </CardPage>
  );
}
