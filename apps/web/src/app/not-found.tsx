import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <p className="text-5xl font-semibold">404</p>
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        {t('backHome')}
      </Link>
    </main>
  );
}
