/**
 * The signed-in person in the console's chrome. They are their avatar (their
 * name's or email's initial in a circle); the email itself is printed only on
 * the account settings page (`/account`), where everything about the account
 * lives — name, language, theme, password and signing out. Every way to the
 * account goes straight there, with no menu in between.
 */

import { Link } from 'react-router';
import { useTranslations } from 'use-intl';

import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** The person's mark: the first letter of their name, else of their email. */
export function Avatar({ name, email, size = 'sm' }: { name?: string | null; email?: string | null; size?: 'sm' | 'lg' }) {
  const letter = [...(name?.trim() || email || '?')][0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-secondary font-semibold text-foreground ring-1 ring-border',
        size === 'sm' ? 'size-7 text-xs' : 'size-16 text-2xl',
      )}
    >
      {letter}
    </span>
  );
}

/**
 * The sidebar's foot (after Router9 Studio's account row): the avatar, the
 * person's name and one line about them here (`detail`), the whole row leading
 * to the account settings.
 */
export function AccountRow({ detail, onNavigate }: { detail: string; onNavigate?: () => void }) {
  const t = useTranslations('account');
  const { session } = useSession();
  const user = session.user;
  return (
    <Link
      to="/account"
      onClick={onNavigate}
      title={t('title')}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Avatar name={user?.name} email={user?.email} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{user?.name || t('title')}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}

/** A top bar's way to the account: the avatar alone. */
export function AccountAvatarLink() {
  const t = useTranslations('account');
  const { session } = useSession();
  return (
    <Link
      to="/account"
      aria-label={t('title')}
      title={t('title')}
      className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Avatar name={session.user?.name} email={session.user?.email} />
    </Link>
  );
}
