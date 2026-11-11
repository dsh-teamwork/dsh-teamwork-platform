import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { LocalePicker } from '@/components/locale-picker';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';

export function ConsoleHeader({ email }: { email: string }) {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link href="/" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {tc('appName')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{email}</span>
        <LocalePicker />
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            {tc('signOut')}
          </Button>
        </form>
      </div>
    </header>
  );
}
