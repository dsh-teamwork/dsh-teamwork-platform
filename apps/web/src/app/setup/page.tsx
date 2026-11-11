import { setupOpen } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SetupForm } from '@/components/auth/password-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { strategy } from '@/lib/auth/strategy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('setup'))('title'), robots: { index: false } };
}

/**
 * Where the link the server prints at start leads: the instance's first
 * account, while no password exists yet (ADR 0006). The token is checked when
 * the form is sent, not here, so the page says nothing about whether it is right.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await searchParams;
  const open = strategy.passwords && typeof token === 'string' && (await setupOpen());
  const t = await getTranslations('setup');

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{open ? t('description') : t('closed')}</CardDescription>
        </CardHeader>
        {open && (
          <CardContent>
            <SetupForm token={token} />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
