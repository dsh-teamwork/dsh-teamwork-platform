import { PLUGIN_CHALLENGE } from '@dsh-teamwork/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PluginAuthorize } from '@/components/plugin-authorize';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plugin'))('title'), robots: { index: false } };
}

/** Where `/team login` in DSH sends the browser: confirm, then copy the code back. */
export default async function PluginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { challenge } = await searchParams;
  const valid = typeof challenge === 'string' && PLUGIN_CHALLENGE.test(challenge);
  if (valid && !(await currentUser())) redirect(`/sign-in?next=${encodeURIComponent(`/plugin?challenge=${challenge}`)}`);
  const t = await getTranslations('plugin');

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{valid ? t('description') : t('invalid')}</CardDescription>
        </CardHeader>
        {valid && (
          <CardContent>
            <PluginAuthorize challenge={challenge} />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
