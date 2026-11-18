/**
 * The frame of a team's console (`/teams/{teamId}/…`): a sidebar with the team
 * switcher, the pages in groups and the account menu, and the page beside it.
 * The console is work first (ADR 0043): everyone sees Workspace — the home
 * page, what the team provides, their own submissions and an edition's work
 * pages — and the team's admin alone sees Team management, folded at the
 * sidebar's foot. On a narrow screen the sidebar becomes a top bar whose menu opens the same navigation in a
 * sheet. Which pages exist is `GROUPS`; the router sends a member who opens a
 * management page home (`AdminOnly` in pages/team/layout.tsx).
 */

import {
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronUp,
  ChevronsUpDown,
  Cpu,
  Gauge,
  GitPullRequestArrow,
  History,
  House,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  Puzzle,
  Send,
  Server,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

import { AccountRow } from '@/components/account';
import { ThemeToggle } from '@/components/theme-toggle';
import { api, type Team, type TeamSummary } from '@/lib/api';
import { editionTeamPages, navPath, type TeamGroup, type TeamPage } from '@/lib/edition';
import { cn } from '@/lib/utils';

type SectionKey = 'overview' | 'resources' | 'submissions' | 'models' | 'presets' | 'plugins' | 'sharing' | 'history' | 'members' | 'usage' | 'budgets' | 'sharedHosts';

/**
 * The console's pages, in their groups: each page's path below `/teams/{teamId}` and its icon.
 * Workspace is everyone's; the admin's pages split by what they look after: what the
 * team publishes to its members' DSHs, and who is in it and what they spend.
 */
const GROUPS: { key: TeamGroup; sections: { path: string; key: SectionKey; icon: LucideIcon }[] }[] = [
  {
    key: 'work',
    sections: [
      { path: '', key: 'overview', icon: House },
      { path: 'resources', key: 'resources', icon: BookOpen },
      { path: 'submissions', key: 'submissions', icon: Send },
      { path: 'shared-hosts', key: 'sharedHosts', icon: Server },
    ],
  },
  {
    key: 'assets',
    sections: [
      { path: 'models', key: 'models', icon: Cpu },
      { path: 'presets', key: 'presets', icon: Layers },
      { path: 'plugins', key: 'plugins', icon: Puzzle },
      { path: 'sharing', key: 'sharing', icon: GitPullRequestArrow },
      { path: 'history', key: 'history', icon: History },
    ],
  },
  {
    key: 'people',
    sections: [
      { path: 'members', key: 'members', icon: Users },
      { path: 'usage', key: 'usage', icon: ChartNoAxesCombined },
      { path: 'budgets', key: 'budgets', icon: Gauge },
    ],
  },
];

const PATHS = GROUPS.flatMap((g) => g.sections.map((s) => s.path));

/** An edition's team pages that are not open ones it replaced, each listed in the group it names. */
const extraPages = () => editionTeamPages().filter((page) => !PATHS.includes(navPath(page)));

/** The extra pages this person sees in this team: an admin's need the admin, and a page with `visible` waits for its answer. */
function useTeamPages(team: Team): TeamPage[] {
  const [shown, setShown] = useState<{ teamId: string; pages: TeamPage[] }>({ teamId: '', pages: [] });
  useEffect(() => {
    let live = true;
    const candidates = extraPages().filter((page) => page.group === 'work' || team.role === 'admin');
    Promise.all(candidates.map((page) => (page.visible ? page.visible(team).catch(() => false) : Promise.resolve(true)))).then((answers) => {
      if (live) setShown({ teamId: team.id, pages: candidates.filter((_, i) => answers[i]) });
    });
    return () => {
      live = false;
    };
  }, [team]);
  return shown.teamId === team.id ? shown.pages : [];
}

/** The section the path is in, so switching team keeps the person on the same kind of page. */
function sectionOf(pathname: string, teamId: string): string {
  const rest = pathname.slice(`/teams/${teamId}`.length).replace(/^\//, '').split('/')[0] ?? '';
  return PATHS.includes(rest) || extraPages().some((page) => navPath(page) === rest) ? rest : '';
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

/**
 * Workspace at the top; for the team's admin, Team management at the foot of
 * the sidebar, folded by default so the two read apart: its toggle sits just
 * above the account row and opens Team assets and Members and spend above it.
 * It opens by itself on one of its pages, and a waiting review shows on the
 * toggle while it is folded. An edition's entries join the group they name.
 */
function Navigation({ team, section, reviewsWaiting, onNavigate }: { team: Team; section: string; reviewsWaiting: boolean; onNavigate?: () => void }) {
  const t = useTranslations('team');
  const locale = useLocale();
  const pages = useTeamPages(team);
  const managing = GROUPS.some((group) => group.key !== 'work' && group.sections.some((s) => s.path === section)) || pages.some((page) => page.group !== 'work' && navPath(page) === section);
  // Opening one of its pages opens it again, adjusted while rendering rather than in an effect.
  const [open, setOpen] = useState(managing);
  const [wasManaging, setWasManaging] = useState(managing);
  if (managing !== wasManaging) {
    setWasManaging(managing);
    if (managing) setOpen(true);
  }

  const link = (path: string, label: ReactNode, Icon: LucideIcon, dot = false) => (
    <Link key={path} to={href(team.id, path)} onClick={onNavigate} aria-current={section === path ? 'page' : undefined} className={cn(item, section === path && selected)}>
      <Icon className="size-4" aria-hidden />
      <span className="flex-1">{label}</span>
      {/* Amber, as a dot: something waits on the reader here (docs/design.md, "Component rules"). */}
      {dot && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
    </Link>
  );
  const group = ({ key, sections }: (typeof GROUPS)[number]) => (
    <div key={key} className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t(`nav.groups.${key}`)}</p>
      {sections.map((s) => link(s.path, t(`nav.${s.key}`), s.icon, s.key === 'sharing' && reviewsWaiting))}
      {pages.filter((page) => page.group === key).map((page) => link(navPath(page), page.labels[locale === 'zh-CN' ? 'zh-CN' : 'en'], page.icon))}
    </div>
  );

  return (
    <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {group(GROUPS[0])}
      {team.role === 'admin' && (
        <div className="mt-auto flex flex-col gap-4">
          {open && <div id="team-management" className="flex flex-col gap-4">{GROUPS.slice(1).map(group)}</div>}
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="team-management" className={cn(item, 'font-medium')}>
            <ShieldCheck className="size-4" aria-hidden />
            <span className="flex-1 text-left">{t('nav.groups.manage')}</span>
            {!open && reviewsWaiting && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
            <ChevronUp className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        </div>
      )}
    </nav>
  );
}

/** The team the console shows, and every other team the person is in. */
function TeamSwitcher({ team, teams, section }: { team: Team; teams: TeamSummary[]; section: string }) {
  const t = useTranslations('team');
  const navigate = useNavigate();
  const leave = () => {
    if (!confirm(t('leave.confirm'))) return;
    api(`teams/${team.id}/membership`, { method: 'DELETE' }).then(
      () => {
        toast.success(t('leave.done'));
        navigate('/teams');
      },
      () => toast.error(t('leave.failed')),
    );
  };
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
          {/* An admin hands the team over first (Members), so only a member leaves from here. */}
          {team.role === 'member' && (
            <DropdownMenu.Item className={menuItem} onSelect={leave}>
              <LogOut className="size-4" aria-hidden />
              {t('leave.submit')}
            </DropdownMenu.Item>
          )}
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
