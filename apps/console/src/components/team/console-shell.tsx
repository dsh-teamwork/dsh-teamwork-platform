/**
 * The frame of a team's console (`/teams/{teamId}/…`): a sidebar with the team
 * switcher, one link per page and the account, and the page beside it. On a
 * narrow screen the sidebar becomes a bar above the page. Which pages exist is
 * `SECTIONS`.
 */

import { Check, ChevronsUpDown, Cpu, Layers, LayoutGrid, LayoutDashboard, LogOut, Puzzle, Users, type LucideIcon } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';

import { LocalePicker } from '@/components/locale-picker';
import type { Team, TeamSummary } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Each page of a team's console: its path below `/teams/{teamId}` and its icon. */
const SECTIONS: { path: string; key: 'overview' | 'models' | 'presets' | 'plugins' | 'members'; icon: LucideIcon }[] = [
  { path: '', key: 'overview', icon: LayoutDashboard },
  { path: 'models', key: 'models', icon: Cpu },
  { path: 'presets', key: 'presets', icon: Layers },
  { path: 'plugins', key: 'plugins', icon: Puzzle },
  { path: 'members', key: 'members', icon: Users },
];

/** The section the path is in, so switching team keeps the person on the same kind of page. */
function sectionOf(pathname: string, teamId: string): string {
  const rest = pathname.slice(`/teams/${teamId}`.length).replace(/^\//, '').split('/')[0] ?? '';
  return SECTIONS.some((s) => s.path === rest) ? rest : '';
}

const href = (teamId: string, path: string) => (path ? `/teams/${teamId}/${path}` : `/teams/${teamId}`);

export function ConsoleShell({
  team,
  teams,
  email,
  passwords,
  children,
}: {
  team: Team;
  teams: TeamSummary[];
  email: string;
  /** The instance holds passwords, so the account offers changing one's own. */
  passwords: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const tp = useTranslations('password');
  const { signOut } = useSession();
  const section = sectionOf(useLocation().pathname, team.id);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b bg-card px-3 py-3 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0 md:py-4">
        <TeamSwitcher team={team} teams={teams} section={section} />
        <nav aria-label={t('nav.label')} className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {SECTIONS.map(({ path, key, icon: Icon }) => (
            <Link
              key={key}
              to={href(team.id, path)}
              aria-current={section === path ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent',
                section === path && 'bg-accent font-medium text-brand',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm text-muted-foreground md:mt-auto md:flex-col md:flex-nowrap md:items-stretch">
          <span className="truncate" title={email}>
            {email}
          </span>
          {passwords && (
            <Link to="/password" className="underline-offset-4 hover:underline">
              {tp('change')}
            </Link>
          )}
          <LocalePicker />
          <button type="button" onClick={() => void signOut()} className="flex items-center gap-2 hover:text-foreground">
            <LogOut className="size-4" aria-hidden />
            {tc('signOut')}
          </button>
        </div>
      </aside>
      <main className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

/** The team the console shows, and every other team the person is in. */
function TeamSwitcher({ team, teams, section }: { team: Team; teams: TeamSummary[]; section: string }) {
  const t = useTranslations('team');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <img src="/logo.svg" alt="" width={32} height={32} className="shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{team.name}</span>
          <span className="text-xs text-muted-foreground">
            {t(`role.${team.role}`)} · {t('list.members', { count: team.members.length })}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-60 rounded-lg border bg-card p-1 text-card-foreground shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">{t('switcher.label')}</DropdownMenu.Label>
          {teams.map((other) => (
            <DropdownMenu.Item key={other.id} asChild>
              <Link
                to={href(other.id, section)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{other.name}</span>
                <span className="text-xs text-muted-foreground">{t(`role.${other.role}`)}</span>
                <Check className={cn('size-4', other.id !== team.id && 'invisible')} aria-hidden />
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link to="/teams" className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent">
              <LayoutGrid className="size-4" aria-hidden />
              {t('switcher.all')}
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The top of a console page: what it is for, and its one main action. */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}
