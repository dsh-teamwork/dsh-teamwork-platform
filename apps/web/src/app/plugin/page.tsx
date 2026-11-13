import { PLUGIN_CHALLENGE } from '@dsh-teamwork/shared';
import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PluginAuthorize } from '@/components/plugin-authorize';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser } from '@/lib/auth';
import { nextAuth } from '@/lib/auth/nextauth';
import { strategy } from '@/lib/auth/strategy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plugin'))('title'), robots: { index: false } };
}

/**
 * Where `/teamwork login` in DSH sends the browser: confirm, then the code goes
 * back. With a `redirect_uri` this server sends codes to (the plugin's loopback
 * listener, or the phone app's scheme) the browser takes it there; without one
 * the person copies it.
 */
export default async function PluginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { challenge, redirect_uri: redirectUri } = await searchParams;
  const returnTo = redirectUri === undefined ? undefined : nextAuth.plugin.returnTo(redirectUri);
  const valid = typeof challenge === 'string' && PLUGIN_CHALLENGE.test(challenge) && returnTo !== null;
  if (valid) {
    const here = `/plugin?${new URLSearchParams({ challenge, ...(returnTo ? { redirect_uri: returnTo.url } : {}) })}`;
    const user = await currentUser();
    if (!user) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
    if (strategy.passwords && (await mustChangePassword(user.id))) redirect(`/password?next=${encodeURIComponent(here)}`);
  }
  const t = await getTranslations('plugin');

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{valid ? t(returnTo?.to === 'app' ? 'descriptionApp' : 'description') : t('invalid')}</CardDescription>
        </CardHeader>
        {valid && (
          <CardContent>
            <PluginAuthorize challenge={challenge} returnTo={returnTo ?? undefined} />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
