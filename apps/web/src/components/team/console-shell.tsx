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
  CircleHelp,
  Cpu,
  Gauge,
  GitPullRequestArrow,
  History,
  House,
  KeyRound,
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
import { Dialog, DropdownMenu, Tooltip } from 'radix-ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

import { AccountRow } from '@/components/account';
import { ThemeToggle } from '@/components/theme-toggle';
import { api, type Team, type TeamSummary } from '@/lib/api';
import { editionTeamPages, navPath, type TeamGroup, type TeamPage } from '@/lib/edition';
import { cn } from '@/lib/utils';

type SectionKey = 'overview' | 'resources' | 'submissions' | 'models' | 'presets' | 'plugins' | 'sharing' | 'history' | 'members' | 'usage' | 'budgets' | 'teamDsh' | 'teamDshHosts';

/**
 * A page in the navigation: its path and icon; whether it fills the area beside the sidebar, as `TeamPage.fill`
 * does; and, for a page only some people have, whether this person sees it in this team, as `TeamPage.visible`.
 */
interface Section {
  path: string;
  key: SectionKey;
  icon: LucideIcon;
  fill?: boolean;
  visible?: (team: Team) => Promise<boolean>;
  /** Whether its entry carries a hint, `nav.hints.{key}`, saying what the page is for. */
  hint?: boolean;
}

/** Whether this person may reach one of this team's shared DSHs (docs/tech/shared-dsh.md): the relay's list, read with the session cookie. */
async function reachesTeamDsh(team: Team) {
  const response = await fetch('/relay/shared', { credentials: 'same-origin' });
  if (!response.ok) return false;
  const { hosts } = (await response.json()) as { hosts: { teamId: string }[] };
  return hosts.some((host) => host.teamId === team.id);
}

/**
 * The console's pages, in their groups: each page's path below `/teams/{teamId}` and its icon.
 * Workspace is everyone's; the admin's pages split by what they look after: what the
 * team publishes to its members' DSHs, and who is in it and what they spend. A page that
 * lays out columns of its own fills the area beside the sidebar, as `TeamPage.fill` does.
 */
const GROUPS: { key: TeamGroup; sections: Section[] }[] = [
  {
    key: 'work',
    sections: [
      { path: '', key: 'overview', icon: House },
      { path: 'resources', key: 'resources', icon: BookOpen },
      { path: 'submissions', key: 'submissions', icon: Send },
      // Listed only where the team runs one this person may reach; the admin's own page is under Team assets.
      { path: 'team-dsh', key: 'teamDsh', icon: Server, fill: true, visible: reachesTeamDsh, hint: true },
    ],
  },
  {
    key: 'assets',
    sections: [
      { path: 'models', key: 'models', icon: Cpu },
      { path: 'presets', key: 'presets', icon: Layers },
      { path: 'plugins', key: 'plugins', icon: Puzzle },
      { path: 'team-dsh-hosts', key: 'teamDshHosts', icon: KeyRound },
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

/**
 * The pages with `visible` this person sees in this team, open sections' paths and an edition's pages, and every
 * extra page they see: an admin's need the admin, and one with `visible` waits for its answer, unlisted until then.
 */
function useTeamPages(team: Team): { pages: TeamPage[]; sections: string[] } {
  const [shown, setShown] = useState<{ teamId: string; pages: TeamPage[]; sections: string[] }>({ teamId: '', pages: [], sections: [] });
  useEffect(() => {
    let live = true;
    const answer = (visible?: (team: Team) => Promise<boolean>) => (visible ? visible(team).catch(() => false) : Promise.resolve(true));
    const candidates = extraPages().filter((page) => page.group === 'work' || team.role === 'admin');
    const sections = GROUPS.flatMap((group) => group.sections).filter((s) => s.visible);
    Promise.all([Promise.all(candidates.map((page) => answer(page.visible))), Promise.all(sections.map((s) => answer(s.visible)))]).then(([pages, open]) => {
      if (live) setShown({ teamId: team.id, pages: candidates.filter((_, i) => pages[i]), sections: sections.filter((_, i) => open[i]).map((s) => s.path) });
    });
    return () => {
      live = false;
    };
  }, [team]);
  return shown.teamId === team.id ? shown : { pages: [], sections: [] };
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
  const fill = GROUPS.some((group) => group.sections.some((s) => s.fill && s.path === section)) || extraPages().some((page) => page.fill && navPath(page) === section);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Its dividers run edge to edge, so the sidebar's parts pad themselves rather than the sidebar padding them. */}
      <aside className="hidden flex-col border-r bg-muted py-4 md:sticky md:top-0 md:flex md:h-dvh">
        <div className="px-3 pb-4">
          <TeamSwitcher team={team} teams={teams} section={section} />
        </div>
        <Navigation team={team} section={section} reviewsWaiting={reviewsWaiting} />
        <div className="flex items-center gap-1 border-t px-3 pt-3">
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
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r bg-muted py-4 md:hidden" aria-describedby={undefined}>
            <div className="flex items-center justify-between gap-2 px-4 pb-4">
              <Dialog.Title className="text-sm font-semibold">{team.name}</Dialog.Title>
              <Dialog.Close className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={t('nav.close')}>
                <X className="size-4" aria-hidden />
              </Dialog.Close>
            </div>
            <Navigation team={team} section={section} reviewsWaiting={reviewsWaiting} onNavigate={close} />
            <div className="flex items-center gap-1 border-t px-3 pt-3">
              <AccountRow detail={t(`role.${team.role}`)} onNavigate={close} />
              <ThemeToggle />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main className={fill ? 'flex min-w-0 flex-1 flex-col md:min-h-dvh' : 'mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8'}>{children}</main>
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
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const { pages, sections: answered } = useTeamPages(team);
  // A section with `visible` is listed once it says yes, or while the person is on it.
  const listed = (s: Section) => !s.visible || answered.includes(s.path) || s.path === section;
  const managing = GROUPS.some((group) => group.key !== 'work' && group.sections.some((s) => s.path === section)) || pages.some((page) => page.group !== 'work' && navPath(page) === section);
  // Opening one of its pages opens it again, adjusted while rendering rather than in an effect.
  const [open, setOpen] = useState(managing);
  const [wasManaging, setWasManaging] = useState(managing);
  if (managing !== wasManaging) {
    setWasManaging(managing);
    if (managing) setOpen(true);
  }

  const link = (path: string, label: ReactNode, Icon: LucideIcon, dot = false, hint?: string) => (
    <NavLink key={path} to={href(team.id, path)} onClick={onNavigate} current={section === path} hint={hint}>
      <Icon className="size-4" aria-hidden />
      <span className="flex-1">{label}</span>
      {/* Amber, as a dot: something waits on the reader here (docs/design.md, "Component rules"). */}
      {dot && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
    </NavLink>
  );
  const group = ({ key, sections }: (typeof GROUPS)[number]) => (
    <div key={key} className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t(`nav.groups.${key}`)}</p>
      {sections.filter(listed).map((s) => link(s.path, t(`nav.${s.key}`), s.icon, s.key === 'sharing' && reviewsWaiting, s.hint ? t(`nav.hints.${s.key}`) : undefined))}
      {pages.filter((page) => page.group === key).map((page) => link(navPath(page), page.labels[lang], page.icon, false, page.hints?.[lang]))}
    </div>
  );

  return (
    <Tooltip.Provider delayDuration={200}>
      <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="px-3 pb-4">{group(GROUPS[0])}</div>
        {/* Team management sits apart from the workspace: its own divider and a slightly deeper ground. */}
        {team.role === 'admin' && (
          <div className="mt-auto flex flex-col gap-4 border-t bg-secondary/60 px-3 py-3">
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
    </Tooltip.Provider>
  );
}

/**
 * One entry in the navigation. One with a hint says what the page is for beside its label: a question mark that
 * shows the hint on hover, and the hint describes the link to a screen reader.
 */
function NavLink({ to, onClick, current, hint, children }: { to: string; onClick?: () => void; current: boolean; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <Link to={to} onClick={onClick} aria-current={current ? 'page' : undefined} aria-describedby={hint ? id : undefined} className={cn(item, current && selected)}>
      {children}
      {hint && (
        <>
          <span id={id} hidden>{hint}</span>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className="grid size-4 shrink-0 place-items-center text-muted-foreground hover:text-foreground" aria-hidden>
                <CircleHelp className="size-3.5" />
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={10} collisionPadding={8} className="z-50 max-w-72 rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-card-foreground shadow-lg">
                {hint}
                <Tooltip.Arrow className="fill-card" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </>
      )}
    </Link>
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
