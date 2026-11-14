import { Navigate } from 'react-router';
import { useTranslations } from 'use-intl';

import { useTitle } from '@/components/page';

import { LocalePicker } from '@/components/locale-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/lib/session';

export function AccountPage() {
  const { session, signOut } = useSession();
  const t = useTranslations('account');
  const tc = useTranslations('common');
  useTitle(t('title'));
  const user = session.user;
  if (!user) return <Navigate to="/sign-in?next=/account" replace />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('email')}</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">{t('name')}</dt>
            <dd>{user.name ?? t('noName')}</dd>
          </dl>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
        <LocalePicker />
        <Button variant="outline" onClick={() => void signOut()}>
          {tc('signOut')}
        </Button>
      </div>
    </main>
  );
}
