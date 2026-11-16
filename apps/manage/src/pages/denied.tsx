import { t } from '../lib/copy';
import { Navigate } from 'react-router';

import { Button } from '../components/ui/button';
import { useAdmin, useTitle } from '../lib/session';

/**
 * A real Google account that is not on ADMIN_EMAILS. A different answer from
 * the sign-in page on purpose: signing in again can never fix it, editing the
 * allowlist can.
 */
export function DeniedPage() {
  useTitle(t('notAnAdmin'));
  const { who, signOut } = useAdmin();
  if (who.kind === 'loading') return null;
  if (who.kind === 'admin') return <Navigate to="/" replace />;
  if (who.kind === 'nobody') return <Navigate to="/login" replace />;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">
          {t('thisAccountIsNotAnAdmin')}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{who.email}</span>{' '}
          {t('deniedHelp')}
        </p>
        <Button type="button" variant="outline" onClick={signOut}>
          {t('signOut')}
        </Button>
      </div>
    </main>
  );
}
