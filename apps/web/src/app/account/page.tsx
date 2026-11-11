import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LocalePicker } from '@/components/locale-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth';
import { signOut } from '@/lib/auth/actions';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account'))('title'), robots: { index: false } };
}

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/account');
  const [t, tc] = await Promise.all([getTranslations('account'), getTranslations('common')]);

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
        <form action={signOut}>
          <Button type="submit" variant="outline">
            {tc('signOut')}
          </Button>
        </form>
      </div>
    </main>
  );
}
