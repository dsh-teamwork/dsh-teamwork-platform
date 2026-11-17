/**
 * The frame of the console's pages outside a team (`/teams`, `/account`): the
 * site's top bar (home, your teams, the docs, the theme and the account) and a
 * footer with the language and the theme, around a page as wide as the home
 * page's sections.
 */

import { BookOpen, LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useTranslations } from 'use-intl';

import { AccountAvatarLink } from '@/components/account';
import { LocalePicker } from '@/components/locale-picker';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const navItem = 'hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:flex';

export function SiteFrame({ children }: { children: ReactNode }) {
  const tc = useTranslations('common');
  const td = useTranslations('docs');
  const tl = useTranslations('team.list');
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-6">
          {/* The public home and docs are served by the server, not by this app's router. */}
          <a href="/" className="mr-auto flex shrink-0 items-center gap-2.5 text-lg font-bold tracking-tight">
            <img src="/logo.svg" alt="" width={30} height={30} />
            {tc('appName')}
          </a>
          <NavLink to="/teams" end className={({ isActive }) => cn(navItem, isActive && 'text-foreground')}>
            <LayoutGrid className="size-4" aria-hidden />
            {tl('title')}
          </NavLink>
          <a href="/docs" className={navItem}>
            <BookOpen className="size-4" aria-hidden />
            {td('title')}
          </a>
          <ThemeToggle />
          <AccountAvatarLink />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10 sm:py-14">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-6 text-sm text-muted-foreground">
          <a href="/" className="hover:text-foreground">
            {td('home')}
          </a>
          <a href="/docs" className="hover:text-foreground">
            {td('title')}
          </a>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <LocalePicker className="h-9" />
          </div>
        </div>
      </footer>
    </div>
  );
}
