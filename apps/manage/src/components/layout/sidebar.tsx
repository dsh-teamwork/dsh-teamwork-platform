import { t } from '../../lib/copy';
import { adminPath } from '../../lib/base';
import { LogOut, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { ThemeToggle } from '../theme-toggle';
import { isNavItemActive, NAV_GROUPS, navHref } from './nav';
import { useAdmin } from '../../lib/session';
import { cn } from '../../lib/utils';

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item, pathname, searchParams);
            return (
              <Link
                key={item.label}
                to={navHref(item)}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <img
        src={adminPath('/logo.svg')}
        alt=""
        width={26}
        height={26}
        className="shrink-0"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold leading-tight">
          DSH Teamwork
        </span>
        <span className="block text-xs leading-tight text-muted-foreground">
          {t('adminConsole')}
        </span>
      </span>
    </Link>
  );
}

function Footer({ email }: { email: string }) {
  const { signOut } = useAdmin();
  return (
    <>
      <div className="px-3 pb-3">
        <ThemeToggle />
      </div>
      <div className="space-y-2 border-t border-border p-3">
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3 w-3" />
          {t('signOut')}
        </button>
      </div>
    </>
  );
}

/** Fixed rail on md+ screens. */
export function Sidebar({ email }: { email: string }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-muted/40 md:flex dark:bg-card">
      <div className="border-b border-border p-4">
        <Brand />
      </div>
      <NavLinks />
      <Footer email={email} />
    </aside>
  );
}

/**
 * Below md the rail becomes a drawer. It is not decoration: triage is work
 * somebody does from a phone, and without it there is no way to change page.
 */
export function MobileNav({ email }: { email: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-muted/40 px-4 md:hidden dark:bg-card">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('openNavigation')}
        aria-expanded={open}
        className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Brand />
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label={t('closeNavigation')}
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex w-64 flex-col bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('closeNavigation')}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <Footer email={email} />
          </div>
        </div>
      )}
    </header>
  );
}
