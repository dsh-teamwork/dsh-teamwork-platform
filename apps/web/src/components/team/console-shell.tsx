/**
 * The frame of a team's console (`/teams/{teamId}/…`): a sidebar with the team
 * switcher, the pages in groups and the account menu, and the page beside it.
 * The console is work first (ADR 0043): everyone sees Workspace — their own
 * home page, what the team provides (their own submissions one link inside),
 * their own usage and an edition's work pages — and the team's admin alone sees Team management at the
 * sidebar's foot, opening on the team overview, where an admin lands (ADR 0049). On a narrow screen the sidebar becomes a top bar whose menu opens the same navigation in a
 * sheet. Which pages exist is `GROUPS`; the router sends a member who opens a
 * management page home (`AdminOnly` in pages/team/layout.tsx). A page reached on several computers (My DSH, an
 * edition's Cloud DSH) folds out under its entry into the computers themselves, each opening its sessions in the
 * column beside the sidebar.
 */

import {
  BookOpen,
  ChartColumn,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Cpu,
  Gauge,
  GitPullRequestArrow,
  History,
  House,
  Laptop,
  LibraryBig,
  Layers,
  Lock,
  Plus,
  Shapes,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Puzzle,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { useCallback, useEffect, useId, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

import { AccountRow } from '@/components/account';
import { ThemeToggle } from '@/components/theme-toggle';
import { api, type Schemas, type Team, type TeamSummary } from '@/lib/api';
import { editionTeamPages, navPath, type SubnavProps, type TeamGroup, type TeamPage } from '@/lib/edition';
import { knowledgeNav, publishKnowledgeNav, useKnowledgeNav } from '@/lib/knowledge-nav';
import { cn } from '@/lib/utils';

type SectionKey = 'home' | 'overview' | 'resources' | 'myUsage' | 'models' | 'presets' | 'plugins' | 'sharing' | 'history' | 'members' | 'usage' | 'budgets' | 'myDsh' | 'artifacts' | 'knowledge';

/** Where the sidebar shows an amber dot: something waits on the admin there. */
export interface Waiting {
  overview: boolean;
}

/** A page in the navigation: its path and icon, and whether it fills the area beside the sidebar, as `TeamPage.fill` does. */
interface Section {
  path: string;
  key: SectionKey;
  icon: LucideIcon;
  fill?: boolean;
  /** What folds out under its entry: the computers it is reached on, as `TeamPage.subnav`. */
  subnav?: ComponentType<SubnavProps>;
  /** An edition's pages in this group are listed right after this one, rather than at the group's end. */
  editions?: boolean;
}

type RelayHost = Schemas['RelayHost'];

/** This person's own computers that connected to the relay, most recently seen first (docs/tech/relay.md, "My DSH in the web console"). */
export async function ownComputers(): Promise<RelayHost[]> {
  const response = await fetch('/relay/hosts', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`relay hosts: ${response.status}`);
  return ((await response.json()) as { hosts: RelayHost[] }).hosts;
}

/** How often a list of computers is read again while it is shown, for each one's online state. */
export const COMPUTERS_REFRESH_MS = 10_000;

/**
 * Two records can share a name (two DSHs on one machine, or one signed in again): a short id after the name tells them
 * apart, or null where the name is the only one.
 */
export function twinOf(hosts: readonly { id: string; name: string }[], host: { id: string; name: string }): string | null {
  return hosts.some((other) => other.id !== host.id && other.name === host.name) ? `#${host.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}` : null;
}

/** My DSH's computers under its entry, read again while they are shown; each opens its sessions beside the sidebar. */
function MyDshNav({ teamId, current, onNavigate }: SubnavProps) {
  const [hosts, setHosts] = useState<RelayHost[] | null>(null);
  const load = useCallback(() => ownComputers().then(setHosts, () => undefined), []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), COMPUTERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  return (hosts ?? []).map((host) => (
    <SubnavLink
      key={host.id}
      to={`/teams/${teamId}/my-dsh/${host.id}`}
      name={host.name}
      twin={twinOf(hosts ?? [], host)}
      online={host.online}
      current={current === host.id}
      onNavigate={onNavigate}
    />
  ));
}

/**
 * Knowledge's spaces under its entry (lib/knowledge-nav.ts), each opening its
 * documents beside the sidebar, the open one selected; for the team's admin,
 * New space after them. Away from the knowledge page the tree is read once.
 */
function KnowledgeNav({ teamId, current, onNavigate }: SubnavProps) {
  const t = useTranslations('team');
  const nav = useKnowledgeNav();
  const ours = nav?.teamId === teamId ? nav : null;
  useEffect(() => {
    if (ours) return;
    let live = true;
    api<Schemas['KnowledgeTree']>(`teams/${encodeURIComponent(teamId)}/knowledge`).then(
      (tree) => {
        // The knowledge page may have published meanwhile, with the space it shows.
        if (!live || knowledgeNav()?.teamId === teamId) return;
        publishKnowledgeNav({ teamId, spaces: tree.spaces.map((s) => ({ id: s.id, name: s.name, reading: s.reading })), canCreateSpace: tree.canCreateSpace, current: '' });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [teamId, ours]);
  if (!ours) return null;
  // Selected only while the knowledge page is open.
  const open = current === null ? '' : ours.current;
  return (
    <>
      {ours.spaces.map((space) => (
        <Link
          key={space.id}
          to={`/teams/${teamId}/knowledge/spaces/${space.id}`}
          onClick={onNavigate}
          aria-current={open === space.id ? 'page' : undefined}
          title={space.name}
          className={cn(item, 'gap-2 py-1', open === space.id && selected)}
        >
          <span className="min-w-0 truncate">{space.name}</span>
          {space.reading === 'members' && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t('knowledge.restricted')} />}
        </Link>
      ))}
      {ours.canCreateSpace && (
        <Link to={`/teams/${teamId}/knowledge?newSpace`} onClick={onNavigate} className={cn(item, 'gap-2 py-1 text-muted-foreground hover:text-foreground')}>
          <Plus className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{t('knowledge.newSpace')}</span>
        </Link>
      )}
    </>
  );
}

/**
 * The console's pages, in their groups: each page's path below `/teams/{teamId}` and its icon.
 * Workspace is everyone's; the admin's pages split by what they look after: what the
 * team publishes to its members' DSHs, and who is in it and what they spend. A page that
 * lays out columns of its own fills the area beside the sidebar, as `TeamPage.fill` does.
 */
const GROUPS: { key: TeamGroup | 'manage'; sections: Section[] }[] = [
  {
    key: 'work',
    sections: [
      // Work first: the DSHs to work in, then what the team shares, then the reader's own spend.
      { path: 'home', key: 'home', icon: House },
      // Always listed, so a new member finds it before connecting; the same computers in every team. An edition's
      // DSH (the hosted service's cloud DSH) follows it.
      { path: 'my-dsh', key: 'myDsh', icon: Laptop, fill: true, subnav: MyDshNav, editions: true },
      // What agents published (docs/tech/artifacts.md); in every team, always listed.
      { path: 'artifacts', key: 'artifacts', icon: Shapes, fill: true },
      // What the team knows, as documents people and agents keep (docs/tech/knowledge.md); in every team.
      // Its spaces fold out beneath it.
      { path: 'knowledge', key: 'knowledge', icon: LibraryBig, fill: true, subnav: KnowledgeNav },
      { path: 'resources', key: 'resources', icon: BookOpen },
      { path: 'my-usage', key: 'myUsage', icon: ChartColumn },
    ],
  },
  // The team overview heads Team management on its own; the toggle below it names the group.
  {
    key: 'manage',
    sections: [{ path: 'overview', key: 'overview', icon: LayoutDashboard }],
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

/**
 * An edition's extra pages this person sees in this team: an admin's need the admin, and one with `visible` waits for
 * its answer, unlisted until then.
 */
function useTeamPages(team: Team): TeamPage[] {
  const [shown, setShown] = useState<{ teamId: string; pages: TeamPage[] }>({ teamId: '', pages: [] });
  useEffect(() => {
    let live = true;
    const answer = (visible?: (team: Team) => Promise<boolean>) => (visible ? visible(team).catch(() => false) : Promise.resolve(true));
    const candidates = extraPages().filter((page) => page.group === 'work' || team.role === 'admin');
    Promise.all(candidates.map((page) => answer(page.visible))).then((pages) => {
      if (live) setShown({ teamId: team.id, pages: candidates.filter((_, i) => pages[i]) });
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

/** The segment after the section in the path, which names the open computer on a page with a subnav. */
function computerOf(pathname: string, teamId: string): string {
  return pathname.slice(`/teams/${teamId}`.length).replace(/^\//, '').split('/')[1] ?? '';
}
const item = 'relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
// The selected section: a grey fill and, beside it, the navy bar that says this is the team's (docs/design.md, "Component rules").
const selected = 'bg-secondary font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand';
const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent';

export function ConsoleShell({
  team,
  teams,
  waiting,
  children,
}: {
  team: Team;
  teams: TeamSummary[];
  /** Something waits on this admin: the amber dots beside the team overview and, for a submission, the review page. */
  waiting: Waiting;
  children: ReactNode;
}) {
  const t = useTranslations('team');
  const section = sectionOf(useLocation().pathname, team.id);
  const fill = GROUPS.some((group) => group.sections.some((s) => s.fill && s.path === section)) || extraPages().some((page) => page.fill && navPath(page) === section);
  const [open, setOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [drawerManagementOpen, setDrawerManagementOpen] = useState(false);
  const changeDrawerOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setDrawerManagementOpen(false);
  };
  const close = () => changeDrawerOpen(false);

  useEffect(() => {
    if (team.role !== 'admin') return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isManageShortcut(event)) {
        event.preventDefault();
        const toggleManagement = open ? setDrawerManagementOpen : setManagementOpen;
        toggleManagement((was) => !was);
      } else if (event.key === 'Escape' && !event.repeat && !event.isComposing && !open && managementOpen) {
        // Radix dialogs and menus handle Escape before it reaches the window.
        event.preventDefault();
        setManagementOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [team.role, open, managementOpen]);

  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Its dividers run edge to edge, so the sidebar's parts pad themselves rather than the sidebar padding them. */}
      <aside className="hidden flex-col border-r bg-muted py-4 md:sticky md:top-0 md:flex md:h-dvh">
        <div className="px-3 pb-4">
          <TeamSwitcher team={team} teams={teams} section={section} />
        </div>
        <Navigation team={team} section={section} waiting={waiting} open={managementOpen} setOpen={setManagementOpen} />
        <div className="flex items-center gap-1 border-t px-3 pt-3">
          <AccountRow detail={t(`role.${team.role}`)} />
          <ThemeToggle />
        </div>
      </aside>

      {/* Narrow screens: the team and a menu button; the menu opens the same navigation in a sheet. */}
      <Dialog.Root open={open} onOpenChange={changeDrawerOpen}>
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
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto scrollbar-quiet border-r bg-muted py-4 md:hidden"
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
              if (event.repeat || event.isComposing) {
                event.preventDefault();
              } else if (team.role === 'admin' && drawerManagementOpen) {
                event.preventDefault();
                setDrawerManagementOpen(false);
              }
            }}
          >
            <div className="flex items-center justify-between gap-2 px-4 pb-4">
              <Dialog.Title className="text-sm font-semibold">{team.name}</Dialog.Title>
              <Dialog.Close className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={t('nav.close')}>
                <X className="size-4" aria-hidden />
              </Dialog.Close>
            </div>
            <Navigation team={team} section={section} waiting={waiting} open={drawerManagementOpen} setOpen={setDrawerManagementOpen} onNavigate={close} />
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
 * It starts folded, on its own pages too; an item that needs attention shows on the toggle
 * while it is folded. An edition's entries join the group they name.
 */
function Navigation({ team, section, waiting, open, setOpen, onNavigate }: {
  team: Team;
  section: string;
  waiting: Waiting;
  open: boolean;
  setOpen: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations('team');
  const locale = useLocale();
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const computer = computerOf(useLocation().pathname, team.id);
  const pages = useTeamPages(team);
  const admin = team.role === 'admin';
  const managementId = useId();
  const shortcut = isMac() ? '⌥M' : 'Alt+M';

  const link = (path: string, label: string, icon: LucideIcon, dot = false, Subnav?: ComponentType<SubnavProps>) =>
    Subnav ? (
      <NavFold key={path} to={href(team.id, path)} label={label} icon={icon} here={section === path} onNavigate={onNavigate}>
        <Subnav teamId={team.id} current={section === path ? computer : null} onNavigate={onNavigate} />
      </NavFold>
    ) : (
      <NavLink
        key={path}
        to={href(team.id, path)}
        onClick={onNavigate}
        current={section === path}
        icon={icon}
        label={label}
        // Amber, as a dot: something waits on the reader here (docs/design.md, "Component rules").
        trailing={dot && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
      />
    );
  const editionLinks = (key: string) => pages.filter((page) => page.group === key).map((page) => link(navPath(page), page.labels[lang], page.icon, false, page.subnav));
  const group = ({ key, sections }: (typeof GROUPS)[number]) => (
    <div key={key} className="flex flex-col gap-0.5">
      {key !== 'manage' && <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{t(`nav.groups.${key}`)}</p>}
      {sections.flatMap((s) => [
        link(s.path, t(`nav.${s.key}`), s.icon, (s.key === 'overview' && waiting.overview), s.subnav),
        ...(s.editions ? editionLinks(key) : []),
      ])}
      {!sections.some((s) => s.editions) && editionLinks(key)}
    </div>
  );

  return (
    <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col">
        {/* Choosing a workspace page, a computer under My DSH included, folds Team management away again. */}
        <div className="scrollbar-quiet min-h-0 overflow-y-auto px-3 pb-4" onClickCapture={(event) => (event.target as Element).closest('a') && setOpen(false)}>
          {group(GROUPS[0])}
        </div>
        {/* Team management sits apart from the workspace, as a navy sheet laid over it: the team's colour, rounded top
            corners and a shadow cast upward onto the workspace. Its tokens are redrawn in the navy's foreground, so the
            rows inside, their hover and the selected bar follow. Its pages slide open above the toggle and fold away
            again (a grid row eased between 0fr and 1fr); open, it takes at most half the sidebar's height and scrolls
            inside, so the workspace stays in view. */}
        {admin && (
          <div className="relative z-10 mt-auto flex max-h-[50dvh] shrink-0 flex-col rounded-t-xl bg-brand pb-1.5 text-foreground shadow-[0_-6px_16px_-6px_rgb(0_0_0/0.25)] dark:shadow-[0_-8px_20px_-4px_rgb(0_0_0/0.6)] [--accent:color-mix(in_oklab,var(--brand-foreground)_12%,transparent)] [--foreground:var(--brand-foreground)] [--muted-foreground:color-mix(in_oklab,var(--brand-foreground)_65%,transparent)] [--ring:var(--brand-foreground)] [--secondary:color-mix(in_oklab,var(--brand-foreground)_16%,transparent)]">
            <div
              className={cn(
                'grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
                open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              {/* Folded, its pages are out of the tab order and hidden from a screen reader as well as from sight. */}
              <div id={managementId} inert={!open} className="scrollbar-quiet min-h-0 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-0.75rem),transparent)] [--brand:var(--brand-foreground)]">
                {/* Padded inside, so the folded row is truly empty; the foot's padding is where a long list fades out above the toggle. */}
                <div className="flex flex-col gap-4 px-3 pt-3 pb-3">{GROUPS.slice(1).map(group)}</div>
              </div>
            </div>
            <div className="px-3 pt-1.5">
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-controls={managementId}
                aria-keyshortcuts={open ? 'Alt+M Escape' : 'Alt+M'}
                title={`${t('nav.groups.manage')} (${shortcut})`}
                // No ground of its own: the toggle is the navy strip's title, its keys always shown, and only its chevron answers a hover.
                className="group/manage flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ShieldCheck className="size-4" aria-hidden />
                <span className="flex-1 text-left">{t('nav.groups.manage')}</span>
                <kbd className="rounded border border-foreground/25 px-1 font-sans text-[11px] leading-4 text-muted-foreground" aria-hidden>
                  {shortcut}
                </kbd>
                {!open && waiting.overview && <span className="size-1.5 rounded-full bg-signal" role="img" aria-label={t('nav.waiting')} />}
                <ChevronUp className={cn('size-4 text-muted-foreground transition-transform group-hover/manage:text-foreground duration-300 motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
              </button>
            </div>
          </div>
        )}
    </nav>
  );
}

/** Alt+M with nothing else held, read by the key's place (Option+M types a letter on a Mac), outside a field being typed in. */
function isManageShortcut(event: KeyboardEvent): boolean {
  if (event.code !== 'KeyM' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** One entry in the navigation: its icon and label, and `trailing` at the row's end. What a page is for, its page says. */
function NavLink({ to, onClick, current, icon: Icon, label, trailing }: { to: string; onClick?: () => void; current: boolean; icon: LucideIcon; label: string; trailing?: ReactNode }) {
  return (
    <Link to={to} onClick={onClick} aria-current={current ? 'page' : undefined} className={cn(item, current && selected)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto flex shrink-0 items-center">{trailing}</span>
    </Link>
  );
}

/** Where the sidebar keeps whether an entry's computers are folded away, for the next visit; unset is unfolded. */
const foldKey = (to: string) => `dsh-teamwork:nav-folded:${to.split('/').pop()}`;

/**
 * An entry whose computers fold out beneath it (`children`, its subnav): the entry opens the page, and the chevron at
 * its end folds them away and back, remembered in this browser. Opening the page unfolds them; folded while the
 * person is on it, the entry itself is the one selected.
 */
function NavFold({ to, label, icon: Icon, here, onNavigate, children }: { to: string; label: string; icon: LucideIcon; here: boolean; onNavigate?: () => void; children: ReactNode }) {
  const t = useTranslations('team');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(foldKey(to)) !== '1';
    } catch {
      return true;
    }
  });
  const fold = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.removeItem(foldKey(to));
      else localStorage.setItem(foldKey(to), '1');
    } catch {
      // A browser that keeps nothing unfolds it again next time.
    }
  };
  // Arriving on the page unfolds its computers, adjusted while rendering rather than in an effect.
  const [wasHere, setWasHere] = useState(here);
  if (here !== wasHere) {
    setWasHere(here);
    if (here && !open) setOpen(true);
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn('relative flex items-center rounded-md hover:bg-accent', here && !open && selected, here && open && 'font-medium')}>
        <Link
          to={to}
          onClick={onNavigate}
          aria-current={here && !open ? 'page' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </Link>
        <button
          type="button"
          onClick={() => fold(!open)}
          aria-expanded={open}
          aria-label={t(open ? 'nav.fold' : 'nav.unfold', { name: label })}
          title={t(open ? 'nav.fold' : 'nav.unfold', { name: label })}
          className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRight className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
        </button>
      </div>
      {open && <div className="ml-[1.2rem] flex flex-col gap-0.5 border-l pl-2">{children}</div>}
    </div>
  );
}

/**
 * One computer under an entry: whether it is online, as a dot, and its name, with `twin` after it where another
 * computer has the same name. Selected while its sessions are open beside the sidebar.
 */
export function SubnavLink({ to, name, twin, online, current, onNavigate }: { to: string; name: string; twin?: string | null; online: boolean; current: boolean; onNavigate?: () => void }) {
  const t = useTranslations('team.dsh');
  return (
    <Link to={to} onClick={onNavigate} aria-current={current ? 'page' : undefined} title={name} className={cn(item, 'gap-2 py-1', current && selected, !online && 'text-muted-foreground')}>
      <span className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')} role="img" aria-label={t(online ? 'online' : 'offline')} />
      <span className="min-w-0 truncate">{name}</span>
      {twin && <span className="shrink-0 font-mono text-xs text-muted-foreground">{twin}</span>}
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
