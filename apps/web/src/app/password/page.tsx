import { returnPath } from '@dsh-teamwork/shared';
import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ChangePasswordForm } from '@/components/auth/password-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('password'))('title'), robots: { index: false } };
}

/** Changing one's own password; where an admin set it, nothing else opens until it is changed. */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = returnPath(params.next, '/teams');
  if (!strategy.passwords) redirect(next);
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/password?next=${next}`)}`);
  const t = await getTranslations('password');

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          {(await mustChangePassword(user.id)) && <CardDescription>{t('mustChange')}</CardDescription>}
        </CardHeader>
        <CardContent>
          <ChangePasswordForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
