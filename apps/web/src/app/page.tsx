import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { LocalePicker } from '@/components/locale-picker';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/lib/auth';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/*
 * The start page every instance has: the mark, what this is, and the one way
 * in. The hosted service's landing page is a site of its own (premium/apps/site);
 * a self-hosted instance needs only this.
 */
export default async function StartPage() {
  const [t, tc, user] = await Promise.all([getTranslations('home'), getTranslations('common'), currentUser()]);
  const start = user ? { href: '/team', label: t('openConsole') } : { href: '/sign-in', label: tc('signIn') };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <Image src="/logo.svg" alt="" width={72} height={72} priority />
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-black tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('tagline')}</p>
      </div>
      <Button asChild size="lg">
        <Link href={start.href}>{start.label}</Link>
      </Button>
      <LocalePicker />
    </main>
  );
}
