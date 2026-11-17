/**
 * The frame of a team's console (`/teams/{teamId}/…`): a sidebar with the team
 * switcher, the pages in groups and the account menu, and the page beside it.
 * The groups follow how a team uses the product: the team's assets (what it
 * publishes), collaboration (how members share and what was kept), and
 * governance (who is in and what they spend); an edition's own team pages
 * join governance. On a narrow screen the sidebar becomes a top bar whose menu
 * opens the same navigation in a sheet. Which pages exist is `GROUPS`.
 */

import {
  ChartNoAxesCombined,
  Check,
  ChevronsUpDown,
  Cpu,
  Gauge,
  GitPullRequestArrow,
  History,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Puzzle,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';

import { AccountRow } from '@/components/account';
import { ThemeToggle } from '@/components/theme-toggle';
import type { Team, TeamSummary } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type SectionKey = 'overview' | 'models' | 'presets' | 'plugins' | 'members' | 'usage' | 'budgets' | 'sharing' | 'history';
type GroupKey = 'assets' | 'collaboration' | 'governance';

/** The console's pages, in their groups: each page's path below `/teams/{teamId}` and its icon. */
const GROUPS: { key: GroupKey | null; sections: { path: string; key: SectionKey; icon: LucideIcon }[] }[] = [
  { key: null, sections: [{ path: '', key: 'overview', icon: LayoutDashboard }] },
  {
    key: 'assets',
    sections: [
      { path: 'models', key: 'models', icon: Cpu },
      { path: 'presets', key: 'presets', icon: Layers },
      { path: 'plugins', key: 'plugins', icon: Puzzle },
    ],
  },
  {
    key: 'collaboration',
    sections: [
      { path: 'sharing', key: 'sharing', icon: GitPullRequestArrow },
      { path: 'history', key: 'history', icon: History },
    ],
  },
  {
    key: 'governance',
    sections: [
      { path: 'members', key: 'members', icon: Users },
      { path: 'usage', key: 'usage', icon: ChartNoAxesCombined },
      { path: 'budgets', key: 'budgets', icon: Gauge },
    ],
  },
];
const PATHS = GROUPS.flatMap((g) => g.sections.map((s) => s.path));

/** The section the path is in, so switching team keeps the person on the same kind of page. */
function sectionOf(pathname: string, teamId: string): string {
  const rest = pathname.slice(`/teams/${teamId}`.length).replace(/^\//, '').split('/')[0] ?? '';
  return PATHS.includes(rest) ? rest : '';
}

const href = (teamId: string, path: string) => (path ? `/teams/${teamId}/${path}` : `/teams/${teamId}`);
const item = 'relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
// The selected section: a grey fill and, beside it, the navy bar that says this is the team's (docs/design.md, "Component rules").
const selected = 'bg-secondary font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand';
const menuItem = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent';

export function ConsoleShell({
  team,
  teams,
  reviewsWaiting,
  children,
}: {
  team: Team;
  teams: TeamSummary[];
  /** Submissions wait for this admin's review: the amber dot beside the review page. */
  reviewsWaiting: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('team');
  const section = sectionOf(useLocation().pathname, team.id);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-4 border-r bg-muted px-3 py-4 md:sticky md:top-0 md:flex md:h-dvh">
        <TeamSwitcher team={team} teams={teams} section={section} />
        <Navigation team={team} section={section} reviewsWaiting={reviewsWaiting} />
        <div className="mt-auto flex items-center gap-1 border-t pt-3">
          <AccountRow detail={t(`role.${team.role}`)} />
          <ThemeToggle />
        </div>
      </aside>

      {/* Narrow screens: the team and a menu button; the menu opens the same navigation in a sheet. */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-muted px-3 py-2 md:hidden">
          <div className="min-w-0 flex-1">
            <TeamSwitcher team={team} teams={teams} section={section} />
          </div>
          <Dialog.Trigger className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={t('nav.open')}>
            <Menu className="size-5" aria-hidden />
          </Dialog.Trigger>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/30 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto border-r bg-muted px-3 py-4 md:hidden" aria-describedby={undefined}>
            <div className="flex items-center justify-between gap-2 px-1">
              <Dialog.Title className="text-sm font-semibold">{team.name}</Dialog.Title>
              <Dialog.Close className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={t('nav.close')}>
                <X className="size-4" aria-hidden />
              </Dialog.Close>
            </div>
            <Navigation team={team} section={section} reviewsWaiting={reviewsWaiting} onNavigate={close} />
            <div className="mt-auto flex items-center gap-1 border-t pt-3">
              <AccountRow detail={t(`role.${team.role}`)} onNavigate={close} />
              <ThemeToggle />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

/** The console's pages in their groups, then an edition's own team pages under governance. */
function Navigation({ team, section, reviewsWaiting, onNavigate }: { team: Team; section: string; reviewsWaiting: boolean; onNavigate?: () => void }) {
  const t = useTranslations('team');
  const { session } = useSession();
  const locale = useLocale();
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <div key={group.key ?? 'top'} className="flex flex-col gap-0.5">
          {group.key && <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t(`nav.groups.${group.key}`)}</p>}
          {group.sections.map(({ path, key, icon: Icon }) => (
            <Link key={key} to={href(team.id, path)} onClick={onNavigate} aria-current={section === path ? 'page' : undefined} className={cn(item, section === path && selected)}>
              <Icon className="size-4" aria-hidden />
              <span className="flex-1">{t(`nav.${key}`)}</span>
              {/* Amber, as a dot: something waits on the reader here (docs/design.md, "Component rules"). */}
              {key === 'sharing' && reviewsWaiting && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
            </Link>
          ))}
          {group.key === 'governance' &&
            session.teamPages.map((page) => (
              <a key={page.path} href={`${page.path}${encodeURIComponent(team.id)}`} className={item}>
                <LayoutGrid className="size-4" aria-hidden />
                {page.labels[locale === 'zh-CN' ? 'zh-CN' : 'en']}
              </a>
            ))}
        </div>
      ))}
    </nav>
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
          <span className="text-xs text-muted-foreground">{t('list.members', { count: team.members.length })}</span>
        </span>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', team.role === 'admin' ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground')}>
          {t(`role.${team.role}`)}
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
              <Link to={href(other.id, section)} className={menuItem}>
                <span className="min-w-0 flex-1 truncate">{other.name}</span>
                <span className="text-xs text-muted-foreground">{t(`role.${other.role}`)}</span>
                <Check className={cn('size-4', other.id !== team.id && 'invisible')} aria-hidden />
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link to="/teams" className={menuItem}>
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
