import { returnPath } from '@dsh-teamwork/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SignInForm } from '@/components/auth/sign-in-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('signIn'))('title'), robots: { index: false } };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = returnPath(params.next, '/teams');
  if (await currentUser()) redirect(next);
  const t = await getTranslations('signIn');

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t(strategy.passwords ? (strategy.google ? 'subtitlePasswordGoogle' : 'subtitlePassword') : strategy.google ? 'subtitle' : 'subtitleEmailOnly')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm next={next} google={strategy.google} passwords={strategy.passwords} initialError={typeof params.error === 'string' ? params.error : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
