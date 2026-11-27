/**
 * What the console's pages for reaching a DSH share (My DSH, my-dsh.tsx): the two columns
 * beside the sidebar, a computer's sessions (grouped as DSH's own sidebar groups them) and PIN as its DSH reports them
 * through the relay, the conversation (a new
 * session included, which keeps its view as it starts), the composer laid out as DSH's own input bar, and the PIN gate. Everything here runs over `@/lib/relay`, end to end encrypted to the DSH, unless the page
 * provides another `SessionClient` (`SessionClientContext`): an edition's server may reach a computer itself.
 */

import { Archive, ArchiveRestore, ArrowUp, Brain, Check, ChevronDown, ChevronRight, Copy, Ellipsis, FileText, Folder, Loader, Lock, MessagesSquare, Paperclip, PencilLine, Pin, PinOff, Plus, Search, Server, ShieldAlert, ShieldCheck, SlidersHorizontal, Square, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import {
  applySessionEvent,
  frameBatch,
  defaultDirectory,
  deliverFiles,
  imageMediaType,
  EMPTY_SESSION,
  ensureFileTarget,
  fileSize,
  newFileDraft,
  uploadFiles,
  validateFiles,
  type PickedFile,
  type UploadLimits,
  isThinking,
  directoryName,
  modelDetail,
  pinPrompt,
  RelayError,
  rowsOf,
  searchSessions,
  archiveFilters, sessionGroupings, workspaceRows, sessionSorts, visibleSessionGroups, orderedSessionGroups, readSessionView,
  type SessionView,
  visibleConversationRows,
  type ModelSelection,
  type PinState,
  type RelayClient,
  type RelayErrorCode,
  type SessionConfiguration,
  type SessionOptions,
  type SessionEvent,
  type SessionState,
  type SessionSummary,
} from '@dsh-teamwork/relay-client';
import type { PublishedArtifact } from '@dsh-teamwork/relay-client';
import { KIND_ICON, ArtifactViewer } from '@/components/artifact-viewer';
import { PresetAvatar } from '@/components/preset-avatar';
import { ProviderMark } from '@/components/provider-mark';
import { Button } from '@/components/ui/button';
import { CodePrompt, CodeSlots } from '@/components/ui/code-entry';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { relayFor } from '@/lib/relay';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';
import { ChangesReview, FileView, FilesPage, type FileTarget } from './session-files';
import { openTab, setOpen } from './session-sidebar-state';
import { SessionSidebar, SidebarOpenButton, SidebarSlotContext, useSidebarState } from './session-sidebar';
import { SessionMarkdown } from './session-markdown';
import { changesByTurn, SessionSteps, TurnFiles, turnTails, WorkToggle, type ChangesSource } from './session-work';
import { ReminderNote, SessionTasks, useTasks } from './dsh-tasks';

/** What the session parts speak to: a computer's sessions and its PIN. */
export type SessionClient = Pick<
  RelayClient,
  | 'listSessions' | 'watchSessions' | 'follow' | 'older' | 'createSession' | 'configuration' | 'selectModel'
  | 'uploadCapabilities' | 'startUpload' | 'uploadChunk' | 'finishUpload' | 'cancelUpload' | 'cancel' | 'prompt' | 'answer'
  | 'renameSession' | 'pinSession' | 'archiveSession' | 'selectPermission' | 'listFiles' | 'searchFiles' | 'readFile' | 'readDocument' | 'statFile' | 'turnChanges' | 'changeDiff'
  | 'watchPin' | 'unlock' | 'setPin'
  | 'listTasks' | 'watchTasks' | 'createTask' | 'updateTask' | 'deleteTask' | 'runTask' | 'taskHistory'
>;

/** A client a page provides in place of this browser's relay, for computers it reaches another way. */
export const SessionClientContext = createContext<SessionClient | null>(null);

export function useSessionClient(): SessionClient {
  const { me } = useTeam();
  return useContext(SessionClientContext) ?? relayFor(me);
}

const WORDED = new Set(['file_type', 'file_name', 'file_too_large', 'image_too_large', 'image_model_unsupported', 'invalid_upload', 'upload_expired', 'upload_failed', 'upload_cancelled', 'upload_unsupported', 'send_uncertain', 'offline', 'not_found', 'busy', 'stale', 'locked', 'device_key_changed', 'device_verification_required', 'no_directory', 'not_authenticated', 'missing_tools', 'missing_plugins', 'preset_unavailable', 'model_unavailable', 'invalid_request', 'not_text', 'document_too_large', 'document_empty', 'preview_unavailable', 'preview_unsupported', 'schedule_conflict', 'schedule_ended', 'schedule_invalid', 'target_archived']);

/** A relay failure in the reader's words; anything unforeseen is "unavailable". */
export function useRelayError() {
  const t = useTranslations('relayErrors');
  return (error: unknown) => t(error instanceof RelayError && WORDED.has(error.code) ? error.code : 'unavailable');
}

/** A row in the column, and the selected one: a grey fill and the navy bar, as in the console's sidebar (docs/design.md, "Component rules"). */
export const row = 'relative flex items-center rounded-md px-2.5 py-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
export const selected = 'bg-secondary before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand';

export function Dot({ className, label }: { className: string; label?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', className)} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />;
}

/**
 * The columns beside the sidebar: `header` (the open computer, or the page's title) and `list` (its sessions) on the
 * left, the conversation or the computer's state on the right. On a narrow screen the list folds under a button.
 */
export function DshColumns({ header, list, children }: { header: ReactNode; list: (onPick: () => void) => ReactNode; children: ReactNode }) {
  const t = useTranslations('team.dsh');
  const [menu, setMenu] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  // The room the conversation and a session's sidebar share: the row, less the column of sessions beside it.
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const measure = () => {
      if (!row.current || !aside.current) return;
      const beside = getComputedStyle(row.current).flexDirection === 'row' ? aside.current.offsetWidth : 0;
      setRoom(row.current.clientWidth - beside);
    };
    const observer = new ResizeObserver(measure);
    if (row.current) observer.observe(row.current);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={row} className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside ref={aside} className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-72 md:shrink-0 md:border-r md:border-b-0 md:px-3">
        <div className="flex items-start gap-2.5 md:px-1">
          <div className="min-w-0 flex-1">{header}</div>
          <Button type="button" variant="outline" size="sm" className="md:hidden" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MessagesSquare className="size-4" aria-hidden />
            {t('sessions')}
            <ChevronDown className={cn('size-4 transition-transform', menu && 'rotate-180')} aria-hidden />
          </Button>
        </div>
        <div className={cn(menu ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col gap-0.5 text-sm md:flex')}>
          {list(() => setMenu(false))}
        </div>
      </aside>
      <SidebarSlotContext.Provider value={{ slot, room }}>
        <div className="flex min-w-0 flex-1">
          <section className="mx-auto flex w-full max-w-4xl min-w-0 flex-1 flex-col gap-5 px-4 pt-6 md:px-8 md:pt-6">{children}</section>
        </div>
        {/* A session's sidebar (session-sidebar.tsx) is drawn here, beside the conversation, which moves over for it. */}
        <div ref={setSlot} className="contents" />
      </SidebarSlotContext.Provider>
    </div>
  );
}

/**
 * One computer's sessions and PIN lock as its DSH reports them, followed while `computerId` is open (a pairing id;
 * none is "", and then nothing is read). `locked` is whether the PIN gate stands before everything else.
 */
export function useComputer(computerId: string) {
  const word = useRelayError();
  const relay = useSessionClient();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [pin, setPin] = useState<PinState | undefined>();
  const [failed, setFailed] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!computerId) return;
    try {
      setSessions(await relay.listSessions(computerId));
      setFailed(null);
    } catch (error) {
      // Locked: the PIN gate says so.
      if (!(error instanceof RelayError && error.code === 'locked')) setFailed(word(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [relay, computerId]);

  useEffect(() => {
    setSessions(null);
    setPin(undefined);
    setFailed(null);
    if (!computerId) return;
    void reload();
    const unwatch = relay.watchSessions(computerId, () => void reload());
    const unpin = relay.watchPin(computerId, (state) => {
      setPin(state);
      if (state?.kind === 'unlocked') void reload();
    });
    return () => { unwatch(); unpin(); };
  }, [relay, computerId, reload]);

  return { sessions, pin, failed, reload, locked: computerId !== '' && pinPrompt(pin, false) !== null };
}

/**
 * A computer's sessions in the column: a search and the view options, a new session, then the sessions as the view
 * options arrange them (`SessionView`: by default each workspace in DSH's order, then Ungrouped, pinned first in each),
 * each group folding away under its name; while searching, the matches in one list instead. The options are kept per
 * member and computer in this browser. Archived sessions follow the archive filter, except that the open one stays
 * listed. `unavailable` says why none
 * can be listed yet (the computer offline, not paired, locked), and nothing can be started or searched meanwhile.
 * Each row has DSH's own actions that fit a browser (pin, rename, copy its id, archive), once the computer's plugin
 * marks its list (`SessionSummary.marks`); an older one offers only the copy.
 */
type SessionListProps = { computerId: string; base: string; unavailable?: string; sessions: SessionSummary[] | null; sessionId: string; onPick: () => void };
export function SessionList(props: SessionListProps) {
  const { me } = useTeam();
  const storageKey = 'dsh.session-view:' + JSON.stringify([me, props.base, props.computerId]);
  return <ComputerSessionList key={storageKey} storageKey={storageKey} {...props} />;
}

function ComputerSessionList({ computerId, base, unavailable, sessions, sessionId, onPick, storageKey }: SessionListProps & { storageKey: string }) {
  const t = useTranslations('team.dsh');
  const [view, setView] = useState(() => {
    try { return readSessionView(localStorage.getItem(storageKey)); } catch { return readSessionView(null); }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(view)); } catch { /* Storage is optional in a private tab. */ }
  }, [view, storageKey]);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(() => visibleSessionGroups(orderedSessionGroups(sessions ?? [], view), view.filter, sessionId), [sessions, view, sessionId]);
  const listed = visible.flatMap((group) => group.sessions);
  const item = (s: SessionSummary) => <SessionRow key={s.id} computerId={computerId} base={base} session={s} open={s.id === sessionId} onPick={onPick} />;
  const options = [
    { key: 'filter', label: 'filterBy', values: archiveFilters },
    { key: 'grouping', label: 'groupBy', values: sessionGroupings },
    { key: 'sort', label: 'orderBy', values: sessionSorts },
  ] as const;
  const fold = (key: string) => setFolded((was) => {
    const next = new Set(was);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const found = query.trim() ? searchSessions(listed, query, true) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-0.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} disabled={!!unavailable} className="h-8 pl-8 text-sm" />
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-8" disabled={!!unavailable} aria-label={t('viewOptions')} title={t('viewOptions')}>
              <SlidersHorizontal className="size-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-44 overflow-y-auto rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
              {options.map((option, index) => (
                <DropdownMenu.RadioGroup key={option.key} value={view[option.key]} aria-label={t(option.label)}
                  onValueChange={(value) => setView({ ...view, [option.key]: value })}>
                  {index > 0 && <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />}
                  <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">{t(option.label)}</DropdownMenu.Label>
                  {option.values.map((value) => (
                    <DropdownMenu.RadioItem key={value} value={value} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent">
                      {t(value)}<DropdownMenu.ItemIndicator><Check className="size-4" /></DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {unavailable ? (
        <Button type="button" size="sm" disabled>
          <Plus className="size-4" aria-hidden />
          {t('newSession')}
        </Button>
      ) : (
        <Button asChild size="sm">
          <Link to={base} onClick={onPick} aria-current={sessionId ? undefined : 'page'}>
            <Plus className="size-4" aria-hidden />
            {t('newSession')}
          </Link>
        </Button>
      )}
      <nav aria-label={t('sessions')} className="scrollbar-quiet -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
        {unavailable ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{unavailable}</p>
        ) : found ? (
          found.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('noMatches')}</p> : found.map(item)
        ) : (
          <>
            {sessions !== null && listed.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t(view.filter === 'only' ? 'noArchived' : 'noSessions')}</p>}
            {workspaceRows(visible, view.grouping, folded).map((group) => {
              if (view.grouping === 'flat') return <div key="flat">{group.sessions.map(item)}</div>;
              const key = group.workspace?.id ?? '';
              const name = group.workspace?.title ?? t('ungrouped');
              const open = !folded.has(key);
              return (
                <div key={key} style={{ marginInlineStart: Math.min(group.depth, 8) * 12 }} className={cn('flex flex-col gap-0.5', group.depth > 0 && 'border-s ps-1')}>
                  <button
                    type="button"
                    onClick={() => fold(key)}
                    aria-expanded={open}
                    title={t(open ? 'collapse' : 'expand', { name })}
                    className={cn(row, 'mt-1 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground')}
                  >
                    <ChevronRight className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
                    <span className="min-w-0 truncate">{name}</span>
                    <span className="ml-auto shrink-0 tabular-nums">{group.sessions.length}</span>
                  </button>
                  {open && group.sessions.map(item)}
                </div>
              );
            })}
          </>
        )}
      </nav>
    </div>
  );
}

/**
 * One session in the column: its title, a pin when pinned, and when it last changed, or "Running"; the menu at its
 * end, and in place of the title a box to rename it. Each action goes to the computer, whose list is read again.
 */
function SessionRow({ computerId, base, session: s, open, onPick }: { computerId: string; base: string; session: SessionSummary; open: boolean; onPick: () => void }) {
  const t = useTranslations('team.dsh');
  const tc = useTranslations('common');
  const format = useFormatter();
  const word = useRelayError();
  const relay = useSessionClient();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = s.title || t('untitled');

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      return true;
    } catch (error) {
      toast.error(word(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function copyId() {
    try {
      await navigator.clipboard.writeText(s.id);
      toast.success(tc('copied'));
    } catch {
      toast.error(tc('copyFailed'));
    }
  }

  if (renaming) {
    const save = async (value: string) => {
      const next = value.trim();
      if (!next || next === s.title) return setRenaming(false);
      if (await act(() => relay.renameSession(computerId, s.id, next))) setRenaming(false);
    };
    return (
      <form className="px-1 py-0.5" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget).get('title') as string); }}>
        <Input
          name="title"
          aria-label={t('actions.title')}
          defaultValue={s.title}
          autoFocus
          maxLength={500}
          disabled={busy}
          className="h-8 text-sm"
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(false); }}
          onBlur={(event) => void save(event.currentTarget.value)}
        />
      </form>
    );
  }

  const item = 'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[disabled]:text-muted-foreground data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground';
  return (
    <div className={cn(row, 'group gap-2', open && cn(selected, 'font-medium'), s.marks?.archived && 'text-muted-foreground')}>
      <Link
        to={`${base}/${s.id}`}
        onClick={onPick}
        title={s.directory}
        aria-current={open ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {s.pending && <Dot className="bg-signal" label={t('waiting')} />}
        {s.marks?.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('actions.pinned')} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={cn('shrink-0 text-xs font-normal text-muted-foreground', s.status === 'running' && !s.pending && 'session-running-label')}>
          {s.status === 'running' ? t('running') : format.relativeTime(new Date(s.updatedAt), new Date())}
        </span>
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={busy}
          aria-label={t('actions.menu', { title })}
          title={t('actions.menu', { title })}
          className="relative -mr-1 flex shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-background md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-4" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-44 rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
            {s.marks && !s.marks.archived && (
              <DropdownMenu.Item className={item} onSelect={() => void act(() => relay.pinSession(computerId, s.id, !s.marks!.pinned))}>
                {s.marks.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                {t(s.marks.pinned ? 'actions.unpin' : 'actions.pin')}
              </DropdownMenu.Item>
            )}
            {s.marks && (
              <DropdownMenu.Item className={item} onSelect={() => setRenaming(true)}>
                <PencilLine aria-hidden />
                {t('actions.rename')}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={item} onSelect={() => void copyId()}>
              <Copy aria-hidden />
              {t('actions.copyId')}
            </DropdownMenu.Item>
            {s.marks && (
              <>
                <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                {/* DSH refuses to archive a running session, as its own sidebar asks first: stop it, then archive it. */}
                <DropdownMenu.Item className={item} disabled={s.status === 'running' && !s.marks.archived}
                  onSelect={() => void act(() => relay.archiveSession(computerId, s.id, !s.marks!.archived))}>
                  {s.marks.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  {t(s.marks.archived ? 'actions.unarchive' : 'actions.archive')}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** Whether a computer is online, as a dot and a word: green while it is, grey when not (docs/design.md, `--success`). */
export function Presence({ online, label }: { online: boolean; label?: string }) {
  const t = useTranslations('team.dsh');
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5', online ? 'text-success' : 'text-muted-foreground')}>
      <span className={cn('size-1.5 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')} aria-hidden />
      {label ?? t(online ? 'online' : 'offline')}
    </span>
  );
}

/**
 * A session, or with `sessionId` "" a new one, which looks like one with nothing in it yet: its first message starts
 * it, and `started` hands the page its id to put in the address. The session started here keeps its view when the
 * address catches up with it, so its first message is not drawn a second time; any other change of `sessionId`
 * (another session, or a new one again) opens a fresh view.
 */
export function Conversation({ computerId, sessionId, title, name, started, tasks }: { computerId: string; sessionId: string; title: string; name: string; started: (sessionId: string) => void; tasks?: string }) {
  const [born, setBorn] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [last, setLast] = useState(sessionId);
  if (sessionId !== last) {
    setLast(sessionId);
    if (sessionId !== born) {
      setBorn(null);
      setRound(round + 1);
    }
  }
  const fresh = sessionId === '' || sessionId === born;
  return (
    <SessionView
      key={fresh ? `new:${round}` : sessionId}
      computerId={computerId}
      sessionId={sessionId}
      title={title}
      name={name}
      tasks={tasks}
      started={(id) => {
        setBorn(id);
        started(id);
      }}
    />
  );
}

/**
 * One session's view: its conversation, what it waits on the member for, and the composer, centred until it starts.
 * `tasks`, the computer's automation tasks' address where it has them, adds the session's tasks to its header and
 * names the task behind each delivery.
 */
function SessionView({ computerId, sessionId, title, name, started, tasks }: { computerId: string; sessionId: string; title: string; name: string; started: (sessionId: string) => void; tasks?: string }) {
  const { team } = useTeam();
  const t = useTranslations('team.dsh');
  const word = useRelayError();
  const relay = useSessionClient();
  // The session's id, from the address, or once its first message started it.
  const [id, setId] = useState(sessionId);
  const [state, setState] = useState<SessionState>(EMPTY_SESSION);
  const [options, setOptions] = useState<SessionOptions>({});
  const [config, setConfig] = useConfiguration(computerId, id);
  // A delivery names its task; only a computer whose tasks this page shows is asked for them.
  const { tasks: taskList } = useTasks(tasks ? computerId : '');
  const files = useFiles(computerId);
  // The first message, shown until the session's own copy of it arrives.
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The session's right sidebar, kept per session in this browser, as DSH keeps its own.
  const [sidebar, changeSidebar] = useSidebarState(id ? `${computerId}.${id}` : null);
  // A file the conversation names opens in a tab of the sidebar, where the computer's plugin can read it.
  const openFile = config?.files && id ? (target: FileTarget) => changeSidebar((s) => openTab(s, { kind: 'file', path: target.path, line: target.line })) : undefined;
  const openArtifact = (artifact: PublishedArtifact) => changeSidebar((s) => openTab(s, { kind: 'artifact', artifact }));

  // Live events are applied a frame at a time (`frameBatch`), not one render each; a snapshot shows at once.
  useEffect(() => {
    if (!id) return;
    const batch = frameBatch<SessionEvent>((events) => setState((s) => events.reduce(applySessionEvent, s)));
    const stop = relay.follow(computerId, id, (event) => {
      batch.push(event);
      if (event.type === 'snapshot') batch.flush();
    });
    return () => { stop(); batch.stop(); };
  }, [relay, computerId, id]);

  const [openedWork, setOpenedWork] = useState<ReadonlySet<string>>(new Set());
  const workKey = (work: string) => JSON.stringify([id, work]);
  const isWorkOpen = (work: string) => openedWork.has(workKey(work));
  const rows = rowsOf(state.items);
  // Each turn's files, gathered at its end once it ends (`turnTails`).
  const endedTurns = useMemo(() => new Set(state.items.flatMap((item) => (item.kind === 'turn-end' ? [item.turn] : []))), [state.items]);
  const changedTurns = useMemo(() => changesByTurn(state.items), [state.items]);
  // A turn's changes come from the computer's own record of them, and open as its review in the sidebar.
  const changes = useMemo<ChangesSource | undefined>(() => (config?.files && id ? {
    load: (seq) => relay.turnChanges(computerId, id, seq),
    diff: (seq, index) => relay.changeDiff(computerId, id, seq, index),
    open: (seq, turn, index) => changeSidebar((s) => openTab(s, { kind: 'changes', seq, turn, index })),
  } : undefined), [config?.files, id, relay, computerId, changeSidebar]);
  const toggleWork = (work: string) => setOpenedWork((open) => {
    const next = new Set(open);
    const key = workKey(work);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const running = state.status === 'running';
  const hero = !id && !sent;

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setFailed(null);
    try {
      await run();
      return true;
    } catch (error) {
      setFailed(word(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start(text: string) {
    setSent(text || files.files.map((file) => file.name).join(', '));
    const ok = await act(async () => {
      const chosen = { cwd: options.cwd, agentPreset: options.agentPreset, teamId: team.id };
      // Files need their session before their bytes move; a retry after a failed upload reuses it.
      const created = files.files.length ? await files.target(chosen) : await relay.createSession(computerId, chosen);
      if (options.model) await relay.selectModel(computerId, created.id, options.model);
      if (options.permission) await relay.selectPermission(computerId, created.id, options.permission);
      // What was chosen stands for the session until the computer's own read of it arrives.
      setConfig((read) => read && {
        ...read,
        permissions: read.permissions && { ...read.permissions, current: options.permission ?? read.permissions.defaultPreset },
        current: {
          sessionId: created.id,
          cwd: options.cwd ?? defaultDirectory(read.directories, read.teamDirectories, team.id) ?? '',
          agentPreset: options.agentPreset ?? read.presets.find((item) => item.isDefault)?.id ?? null,
          model: options.model ?? null,
          started: true,
          running: true,
        },
      });
      // The session exists from here: it is followed and in the address, and a failed send is retried in it.
      setId(created.id);
      started(created.id);
      if (files.files.length) await files.send(created.id, text);
      else await relay.prompt(computerId, created.id, text);
    });
    if (!ok) setSent('');
    return ok;
  }

  const current = id ? config?.current : null;
  const preset = current ? config?.presets.find((item) => item.id === current.agentPreset) : undefined;

  return (
    <>
      {!hero && (
        <header className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{id ? title : t('newTitle')}</h2>
            {id && tasks && <SessionTasks computerId={computerId} tasks={taskList} items={state.items} sessionId={id} base={tasks} />}
            {id && !sidebar.open && <SidebarOpenButton onOpen={() => changeSidebar((s) => setOpen(s, true))} />}
          </div>
          {current && (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={current.cwd}>
              <Folder className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{directoryName(current.cwd) || current.cwd}</span>
              <span aria-hidden>·</span>
              {preset && <PresetAvatar avatar={preset.avatar} name={preset.name} className="size-4" />}
              <span className="truncate">{preset?.name ?? current.agentPreset ?? t('settings.noPreset')}</span>
            </p>
          )}
        </header>
      )}
      {!hero && (
        <div className="flex flex-col gap-4 text-sm">
          {state.earlier !== null && (
            <Button type="button" variant="ghost" size="sm" className="self-center" disabled={busy} onClick={() => void act(() => relay.older(computerId, id))}>
              {t('earlier')}
            </Button>
          )}
          {rows.length === 0 && sent && (
            <p className="ml-auto max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{sent}</p>
          )}
          {turnTails(visibleConversationRows(rows, isWorkOpen), endedTurns, changedTurns).map((entry) => {
            if (entry.kind === 'tail') return <TurnFiles key={`tail-${entry.turn}`} turn={entry.turn} delivered={entry.delivered} changes={entry.changes} source={changes} openFile={openFile} />;
            const row = entry.row;
            return row.kind === 'user' ? (
              <div key={row.id} className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
                {row.attachments?.length ? (
                  <ul className="flex flex-wrap justify-end gap-2">
                    {row.attachments.map((file) => (
                      <li key={file.attachmentId} className="flex max-w-60 items-center gap-2 rounded-md border px-2 py-1 text-xs">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate" title={file.name}>{file.name}</span>
                        <span className="shrink-0 text-muted-foreground">{fileSize(file.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {row.reminders?.map((reminder) => (
                  <ReminderNote key={`${reminder.scheduleId}-${reminder.occurrenceAt}`} occurrenceAt={reminder.occurrenceAt} task={taskList?.find((task) => task.id === reminder.scheduleId)} base={tasks} />
                ))}
                {row.text && <p className="rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.text}</p>}
              </div>
            ) : row.kind === 'artifact' ? (
              <ArtifactCard key={row.id} artifact={row.artifact} onOpen={() => openArtifact(row.artifact)} />
            ) : row.kind === 'assistant' ? (
              <div key={row.id} className="min-w-0">
                <SessionMarkdown text={row.text} openFile={row.streaming ? undefined : openFile} />
                {row.interrupted && <p className="mt-1 text-xs text-muted-foreground">{t('replyStopped')}</p>}
              </div>
            ) : row.kind === 'failed' ? (
              <p key={row.id} role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-destructive [overflow-wrap:anywhere]">
                {row.noModel ? t('noModel') : t('turnFailed', { message: row.message })}
              </p>
            ) : row.kind === 'work' ? (
              <WorkToggle key={row.id} count={row.count} open={isWorkOpen(row.id)} onToggle={() => toggleWork(row.id)} />
            ) : row.kind === 'steps' ? (
              <SessionSteps key={row.id} row={row} openFile={openFile} />
            ) : null;
          })}
          {(isThinking(rows, running) || (rows.length === 0 && sent && !failed)) && (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden />
              {t('thinking')}
            </p>
          )}
          {state.pending?.kind === 'question' && (
            <div className="flex flex-col gap-2 border-l-[3px] border-signal pl-3">
              <p className="font-medium">{state.pending.question}</p>
              <div className="flex flex-wrap gap-2">
                {state.pending.options.map((option) => (
                  <Button key={option.id} size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, id, state.pending!.id, { kind: 'question', optionId: option.id }))}>
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {state.pending?.kind === 'approval' && (
            <div className="flex flex-col gap-2 border-l-[3px] border-signal pl-3">
              <p className="font-medium">{state.pending.title}</p>
              {state.pending.detail && <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{state.pending.detail}</pre>}
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void act(() => relay.answer(computerId, id, state.pending!.id, { kind: 'approval', approve: true }))}>{t('allow')}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, id, state.pending!.id, { kind: 'approval', approve: false }))}>{t('deny')}</Button>
              </div>
            </div>
          )}
          {state.closed && <p role="alert" className="text-destructive">{word(new RelayError(state.closed))}</p>}
        </div>
      )}
      {id && (
        <SessionSidebar
          state={sidebar}
          change={changeSidebar}
          canBrowse={!!config?.files}
          body={({ tab, pane, reload, onReload }) => {
            if (tab.kind === 'artifact') {
              return (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                  <ArtifactViewer key={`${tab.artifact.artifactId}-${tab.artifact.version}`} teamId={tab.artifact.teamId} artifactId={tab.artifact.artifactId} version={tab.artifact.version} />
                </div>
              );
            }
            if (tab.kind === 'files') {
              return <FilesPage client={relay} computerId={computerId} sessionId={id} root={current?.cwd} word={word} reload={reload} onReload={onReload}
                onOpen={(path) => changeSidebar((s) => openTab(s, { kind: 'file', path }, { pane: pane.id }))} />;
            }
            if (tab.kind === 'changes') {
              return <ChangesReview client={relay} computerId={computerId} sessionId={id} root={current?.cwd} word={word} seq={tab.seq} index={tab.index}
                onOpenFile={(path) => changeSidebar((s) => openTab(s, { kind: 'file', path }, { pane: pane.id }))} />;
            }
            if (tab.kind === 'file') {
              return <FileView client={relay} computerId={computerId} sessionId={id} root={current?.cwd} path={tab.path} line={tab.line} word={word} reload={reload} onReload={onReload}
                onOpen={(path) => changeSidebar((s) => openTab(s, { kind: 'file', path }, { replace: true, pane: pane.id }))} />;
            }
            return null;
          }}
        />
      )}
      {/* One composer in both places, so what is typed survives the move from the centre to the foot. */}
      <div className={cn('flex flex-col gap-1', hero ? 'my-auto pb-[10vh]' : 'sticky bottom-0 mt-auto bg-background pt-2 pb-4')}>
        {hero && (
          <section className="flex flex-col items-center gap-2 pb-2 text-center">
            <Server className="size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-2xl font-semibold tracking-tight">{t('newTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('newHint', { name })}</p>
          </section>
        )}
        {!id && config && (
          <StartSettings config={config} disabled={sent !== ''} value={options} onChange={(next) => {
            // Another folder or preset is another session: files sent to the old one are sent again.
            if (next.cwd !== options.cwd || next.agentPreset !== options.agentPreset) files.retarget();
            setOptions(next);
          }} />
        )}
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <Composer
          busy={busy || running || !!state.pending || (!id && sent !== '')}
          rows={hero ? 3 : 2}
          placeholder={t(id ? 'promptPlaceholder' : 'firstPlaceholder')}
          files={files}
          stop={running ? { run: () => void act(() => relay.cancel(computerId, id)), disabled: busy } : undefined}
          tools={config && (
            <PermissionSettings
              computerId={computerId}
              sessionId={id}
              config={config}
              setConfig={setConfig}
              disabled={busy || running || !!state.pending || (!id && sent !== '')}
              value={options.permission}
              onChange={(preset) => setOptions({ ...options, permission: preset })}
            />
          )}
          send={(message) => {
            if (!id) return start(message);
            return act(async () => {
              if (files.files.length) await files.send(id, message);
              else await relay.prompt(computerId, id, message);
            });
          }}
        >
          {config && (
            <ModelSettings
              computerId={computerId}
              sessionId={id}
              config={config}
              setConfig={setConfig}
              disabled={busy || running || !!state.pending || (!id && sent !== '')}
              value={options}
              onChange={setOptions}
            />
          )}
        </Composer>
      </div>
    </>
  );
}

const modelKey = (model: ModelSelection | null | undefined) => (model ? JSON.stringify([model.provider, model.model]) : '');

/** A chip on the composer: a `Select` without its outline, as DSH draws the controls in its input bar. */
const chip = 'h-7 max-w-56 gap-1 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-accent';

/**
 * A session's choices as its computer reports them (`teamwork/configuration`): a new session's read (`sessionId` ""),
 * or that session's, which adds its `current`. The previous read stays while the next one comes, so the controls do
 * not blink when a new session gets its id. A computer whose plugin reports none leaves it null, and its defaults hold.
 */
function useConfiguration(computerId: string, sessionId: string) {
  const relay = useSessionClient();
  const [data, setData] = useState<SessionConfiguration | null>(null);
  useEffect(() => {
    let live = true;
    relay.configuration(computerId, sessionId || undefined).then(
      (read) => { if (live) setData(read); },
      // An older plugin, or a computer that went away: the defaults hold, as before there were choices.
      () => {},
    );
    return () => { live = false; };
  }, [relay, computerId, sessionId]);
  return [data, setData] as const;
}

/**
 * Above a new session's composer, as DSH places them: the folder it starts in (this team's default workspace on the
 * computer unless another is picked) and its preset, both fixed once it starts.
 */
function StartSettings({ config, disabled, value, onChange }: { config: SessionConfiguration; disabled: boolean; value: SessionOptions; onChange: (value: SessionOptions) => void }) {
  const { team } = useTeam();
  const t = useTranslations('team.dsh.settings');
  const word = useRelayError();
  const cwd = value.cwd ?? defaultDirectory(config.directories, config.teamDirectories, team.id) ?? '';
  const fallback = config.presets.find((item) => item.isDefault);
  const presets = [
    { value: '', label: [t('desktopDefault'), fallback?.name].filter(Boolean).join(' · '), icon: fallback && <PresetAvatar avatar={fallback.avatar} name={fallback.name} className="size-4" /> },
    // A preset its computer cannot run yet (a missing tool or plugin) is shown, with why, and cannot be chosen.
    ...config.presets.map((item) => ({
      value: item.id,
      label: [item.name, item.teamName, item.blocked && word(new RelayError(item.blocked as RelayErrorCode))].filter(Boolean).join(' · '),
      disabled: !!item.blocked,
      icon: <PresetAvatar avatar={item.avatar} name={item.name} className="size-4" />,
    })),
  ];
  return (
    // The preset wraps under the folder when both do not fit, and a name longer than the row is cut short.
    <div className="flex flex-wrap items-center gap-0.5">
      {config.directories.length > 0 && (
        <Select label={t('workspace')} value={cwd} disabled={disabled} className={cn(chip, 'max-w-full font-medium')}
          options={config.directories.map((item) => ({ value: item.path, label: item.name, icon: <Folder className="size-4 text-muted-foreground" aria-hidden /> }))}
          change={(path) => onChange({ ...value, cwd: path })} />
      )}
      <Select label={t('preset')} value={value.agentPreset ?? ''} options={presets} disabled={disabled} className={cn(chip, 'max-w-full font-medium')}
        change={(id) => onChange({ ...value, agentPreset: id || undefined, model: undefined })} />
    </div>
  );
}

/** DSH's own permission presets, worded as its picker words them; any other keeps the name DSH gives it. */
const PRESET_WORDS: Record<string, string> = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'fullAccess' };

/**
 * The session's permission preset, at the composer's foot beside the paperclip, as in DSH's own input bar. A new
 * session's is chosen before its first message (`value`); an existing session switches while idle. A risky preset
 * (one that leaves the workspace's sandbox or skips approval) is confirmed once.
 */
function PermissionSettings({ computerId, sessionId, config, setConfig, disabled, value, onChange }: {
  computerId: string;
  sessionId: string;
  config: SessionConfiguration;
  setConfig: (update: (read: SessionConfiguration | null) => SessionConfiguration | null) => void;
  disabled: boolean;
  value: string | undefined;
  onChange: (preset: string) => void;
}) {
  const t = useTranslations('team.dsh.permission');
  const word = useRelayError();
  const relay = useSessionClient();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const permissions = config.permissions;
  if (!permissions || (sessionId && permissions.current === null)) return null;
  const current = sessionId ? permissions.current! : (value ?? permissions.defaultPreset);
  const nameOf = (option: { id: string; name: string }) => (PRESET_WORDS[option.id] ? t(`preset.${PRESET_WORDS[option.id]}`) : option.name);
  const icon = (risky: boolean) => { const Icon = risky ? ShieldAlert : ShieldCheck; return <Icon className="size-4 text-muted-foreground" aria-hidden />; };
  const options: { value: string; label: string; disabled?: boolean; icon: ReactNode }[] = permissions.options.map((option) => ({
    value: option.id,
    label: nameOf(option),
    icon: icon(option.risky),
  }));
  // Settings that match no preset (set by hand on the desktop) show as such, and are left by picking one.
  if (!options.some((option) => option.value === current)) options.unshift({ value: current, label: t('custom'), disabled: true, icon: icon(true) });

  async function choose(id: string) {
    const option = permissions!.options.find((item) => item.id === id);
    if (!option || id === current) return;
    if (option.risky && !confirm(t('confirm', { name: nameOf(option) }))) return;
    if (!sessionId) return onChange(id);
    setSaving(true);
    setFailed(null);
    try {
      const now = await relay.selectPermission(computerId, sessionId, id);
      setConfig((read) => (read?.permissions ? { ...read, permissions: { ...read.permissions, current: now } } : read));
    } catch (error) {
      setFailed(word(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Select label={t('label')} value={current} options={options} disabled={disabled || saving} className={cn(chip, 'max-w-48')} change={(id) => void choose(id)} />
      {failed && <span role="alert" className="text-xs text-destructive">{failed}</span>}
    </>
  );
}

/**
 * The model and its reasoning effort, at the composer's foot beside Send, as in DSH's own input bar. A new session's
 * are chosen before its first message (`value`, given back through `onChange`); an existing session changes its model
 * while it is idle, for that session alone (`teamwork/selectModel`).
 */
function ModelSettings({ computerId, sessionId, config, setConfig, disabled, value, onChange }: {
  computerId: string;
  sessionId: string;
  config: SessionConfiguration;
  setConfig: (update: (read: SessionConfiguration | null) => SessionConfiguration | null) => void;
  disabled: boolean;
  value: SessionOptions;
  onChange: (value: SessionOptions) => void;
}) {
  const t = useTranslations('team.dsh.settings');
  const word = useRelayError();
  const relay = useSessionClient();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (sessionId && !config.current) return null;
  const chosen = sessionId ? config.current?.model : value.model;
  const model = config.models.find((item) => item.provider === chosen?.provider && item.id === chosen?.model);
  const groups = new Map<string, SessionConfiguration['models']>();
  for (const item of config.models) {
    const group = groups.get(item.provider);
    if (group) group.push(item);
    else groups.set(item.provider, [item]);
  }
  const option = 'relative flex items-center gap-2 rounded-md py-1.5 pr-8 pl-2.5 text-sm outline-none data-[disabled]:text-muted-foreground data-[highlighted]:bg-accent';
  const heading = 'px-2.5 py-1 text-xs font-medium text-muted-foreground';
  // DSH names efforts in English; the ones every adapter shares are worded in the console's language.
  const effortName = (effort: { id: string; name: string }) => (t.has(`efforts.${effort.id}`) ? t(`efforts.${effort.id}`) : effort.name);
  const chosenEffort = model?.reasoning?.efforts.find((effort) => effort.id === chosen?.reasoningEffort);
  const indicator = <DropdownMenu.ItemIndicator className="absolute top-1/2 right-2 -translate-y-1/2"><Check className="size-4" aria-hidden /></DropdownMenu.ItemIndicator>;

  async function choose(next: ModelSelection | undefined) {
    if (!sessionId) return onChange({ ...value, model: next });
    if (!next) return;
    setSaving(true);
    setFailed(null);
    try {
      const selected = await relay.selectModel(computerId, sessionId, next);
      setConfig((read) => (read?.current ? { ...read, current: { ...read.current, model: selected } } : read));
    } catch (error) {
      setFailed(word(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {failed && <span role="alert" className="text-xs text-destructive">{failed}</span>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="outline" aria-label={t('model')} disabled={disabled || saving} className={cn(chip, 'min-w-0 font-normal')}>
            {chosen && <ProviderMark hints={[chosen.model, model?.name, model?.providerName, chosen.provider]} name={model?.name ?? chosen.model} />}
            <span className="truncate">{model?.name ?? chosen?.model ?? t(sessionId ? 'model' : 'followPreset')}</span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={5} className="z-50 max-h-(--radix-dropdown-menu-content-available-height) w-64 max-w-(--radix-dropdown-menu-content-available-width) overflow-y-auto rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
            <DropdownMenu.RadioGroup aria-label={t('model')} value={modelKey(chosen)}>
              {!sessionId && (
                <DropdownMenu.RadioItem value="" className={option} disabled={disabled || saving} onSelect={() => void choose(undefined)}>
                  {t('followPreset')}
                  {indicator}
                </DropdownMenu.RadioItem>
              )}
              {!!config.modelFailures.length && <p className="px-2.5 py-1 text-xs text-destructive">{t('modelFailures', { names: config.modelFailures.join(', ') })}</p>}
              {[...groups].map(([provider, items]) => (
                <DropdownMenu.Group key={provider} aria-label={items[0].providerName} className="mt-1 border-t pt-1 first:mt-0 first:border-t-0 first:pt-0">
                  <DropdownMenu.Label className={heading}>{items[0].providerName}</DropdownMenu.Label>
                  {items.map((item) => {
                    const selection = { provider, model: item.id };
                    return (
                      <DropdownMenu.RadioItem key={item.id} value={modelKey(selection)} textValue={item.name} className={option} disabled={disabled || saving}
                        onSelect={() => void choose(selection)}>
                        <ProviderMark hints={[item.id, item.name, item.providerName, provider]} name={item.name} />
                        <span className="min-w-0 break-words">
                          {item.name}
                          {modelDetail(item) && <span className="block text-xs text-muted-foreground">{modelDetail(item)}</span>}
                        </span>
                        {indicator}
                      </DropdownMenu.RadioItem>
                    );
                  })}
                </DropdownMenu.Group>
              ))}
            </DropdownMenu.RadioGroup>
            {!config.models.length && <p className={heading}>{word(new RelayError('model_unavailable'))}</p>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* How hard the chosen model reasons, beside it, where it says it can be told: its own default, or one of its efforts. */}
      {model?.reasoning && model.reasoning.efforts.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button type="button" variant="outline" aria-label={t('effort')} disabled={disabled || saving} className={cn(chip, 'shrink-0 font-normal')}>
              <Brain className="size-4 text-muted-foreground" aria-hidden />
              <span>{chosenEffort ? effortName(chosenEffort) : t('effortDefaultShort')}</span>
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={5} className="z-50 w-44 rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
              <DropdownMenu.RadioGroup aria-label={t('effort')} value={chosen?.reasoningEffort ?? ''} onValueChange={(effort) => void choose({
                provider: model.provider, model: model.id, ...(effort ? { reasoningEffort: effort } : {}),
              })}>
                <DropdownMenu.Label className={heading}>{t('effort')}</DropdownMenu.Label>
                {[{ id: '', name: t('effortDefault') }, ...model.reasoning.efforts].map((effort) => (
                  <DropdownMenu.RadioItem key={effort.id} value={effort.id} className={option} disabled={disabled || saving}>
                    {effort.id ? effortName(effort) : effort.name}
                    {indicator}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </>
  );
}

async function compressAttachment(file: File, limit: number): Promise<File> {
  if (limit <= 0) throw new RelayError('image_too_large');
  if (file.size <= limit) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new RelayError('upload_failed');
    for (const edge of [1600, 1200, 900, 640, 480, 320]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
      if (blob && blob.size <= limit) {
        const extension = blob.type === 'image/webp' ? '.webp' : '.png';
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + extension, { type: blob.type });
      }
    }
    throw new RelayError('image_too_large');
  } finally {
    bitmap.close();
  }
}

type Files = ReturnType<typeof useFiles>;

/**
 * A message's files in this browser (docs/tech/relay.md, "File attachments"): chosen with the browser's picker and
 * kept as the page's own `File`s, checked against the computer's limits, and sent at Send: their bytes in
 * acknowledged chunks, then one prompt with their receipts (`attachments` of the relay client, which the phone app
 * uses too). A computer whose plugin cannot take files offers none.
 */
function useFiles(computerId: string) {
  const t = useTranslations('team.dsh.files');
  const word = useRelayError();
  const relay = useSessionClient();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const blobs = useRef(new Map<string, File>());
  const draft = useRef(newFileDraft());

  useEffect(() => {
    let live = true;
    relay.uploadCapabilities(computerId).then((read) => { if (live) setLimits(read); }, () => { if (live) setLimits(null); });
    return () => { live = false; };
  }, [relay, computerId]);

  function choose(next: PickedFile[]) {
    draft.current.files = next;
    setFiles(next);
  }
  async function add(list: FileList | null) {
    if (!list?.length || !limits) return;
    const selected = Array.from(list);
    setFailed(null);
    setProgress(t('preparing'));
    try {
      if (files.length + selected.length > limits.maxFiles) throw new RelayError('file_too_large');
      const remaining = (limits.maxMessageImageBytes ?? 0) - files.filter((file) => imageMediaType(file.name)).reduce((sum, file) => sum + file.bytes, 0);
      const count = selected.filter((file) => imageMediaType(file.name)).length;
      if (count && !limits.maxImageBytes) throw new RelayError('upload_unsupported');
      const perImage = Math.min(limits.maxImageBytes ?? 0, Math.floor(remaining / Math.max(1, count)));
      const prepared: File[] = [];
      for (const file of selected) {
        prepared.push(imageMediaType(file.name) ? await compressAttachment(file, perImage) : file);
      }
      const picked = prepared.map((file) => {
        const id = crypto.randomUUID();
        return { id, name: file.name, bytes: file.size, uri: id };
      });
      validateFiles([...files, ...picked], limits);
      picked.forEach((file, index) => blobs.current.set(file.id, prepared[index]));
      choose([...files, ...picked]);
    } catch (error) {
      setFailed(word(error));
    } finally {
      setProgress(null);
    }
  }
  async function read(file: PickedFile, offset: number, length: number) {
    const blob = blobs.current.get(file.uri);
    if (!blob) throw new RelayError('upload_expired');
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  }

  function remove(id: string) {
    blobs.current.delete(id);
    draft.current.uploaded.delete(id);
    choose(files.filter((file) => file.id !== id));
  }

  return {
    files, limits, progress, failed, add, remove,
    preview: (file: PickedFile) => imageMediaType(file.name) ? blobs.current.get(file.id) : undefined,
    /** A new session's own: made once, with the files' folder and preset, and kept for a retry. */
    target: (options: SessionOptions) => {
      draft.current.options = options;
      return ensureFileTarget(relay, computerId, draft.current);
    },
    /** The session a new draft made is left behind when its folder or preset changes. */
    retarget: () => {
      draft.current.target = undefined;
      draft.current.uploaded.clear();
    },
    async send(sessionId: string, text: string) {
      setFailed(null);
      const signal = new AbortController().signal;
      try {
        await uploadFiles({
          relay, computerId, sessionId, draft: draft.current, limits, signal,
          read,
          progress: (name, sent, total) => setProgress(t('progress', { name, percent: total ? Math.floor((sent / total) * 100) : 100 })),
        });
        await deliverFiles({ relay, computerId, sessionId, text, draft: draft.current, signal, requestId: () => crypto.randomUUID() });
        blobs.current.clear();
        draft.current = newFileDraft();
        setFiles([]);
      } finally {
        setProgress(null);
      }
    },
  };
}

function AttachButton({ files, disabled }: { files: Files; disabled: boolean }) {
  const t = useTranslations('team.dsh.files');
  const input = useRef<HTMLInputElement>(null);
  if (!files.limits) return null;
  return (
    <>
      <input ref={input} type="file" multiple hidden accept={files.limits.extensions.map((extension) => `.${extension}`).join(',')}
        onChange={(event) => { void files.add(event.target.files); event.target.value = ''; }} />
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('add')} title={t('add')} disabled={disabled || files.progress !== null} onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden />
      </Button>
    </>
  );
}

function AttachmentThumbnail({ file }: { file?: File }) {
  const attach = useCallback((element: HTMLImageElement | null) => {
    if (!element || !file) return;
    const address = URL.createObjectURL(file);
    element.src = address;
    return () => URL.revokeObjectURL(address);
  }, [file]);
  if (file) return <img ref={attach} alt="" className="size-8 rounded object-cover" />;
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function FileCards({ files, disabled }: { files: Files; disabled: boolean }) {
  const t = useTranslations('team.dsh.files');
  if (!files.files.length && !files.failed && !files.progress) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {files.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.files.map((file) => (
            <li key={file.id} className="flex max-w-60 items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
              <AttachmentThumbnail file={files.preview(file)} />
              <span className="truncate" title={file.name}>{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{fileSize(file.bytes)}</span>
              <button type="button" className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50" aria-label={t('remove', { name: file.name })}
                disabled={disabled || files.progress !== null} onClick={() => files.remove(file.id)}>
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.progress && <p role="status" className="text-xs text-muted-foreground">{files.progress}</p>}
      {files.failed && <p role="alert" className="text-xs text-destructive">{files.failed}</p>}
    </div>
  );
}

/**
 * The message box, laid out as DSH's own input bar: the files and the text, then a row with the attachment control on
 * the left with `tools` (the permission preset) and `children` (the model) with the round Send, or Stop while `stop` is offered, on the right. Enter sends,
 * Shift+Enter breaks the line; `send` says whether to clear it.
 */
function Composer({ busy, rows, placeholder, send, files, stop, tools, children }: {
  busy: boolean;
  rows: number;
  placeholder: string;
  send: (text: string) => Promise<boolean>;
  files: Files;
  stop?: { run: () => void; disabled: boolean };
  /** Beside the paperclip on the left: the permission preset. */
  tools?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations('team.dsh');
  const [text, setText] = useState('');
  // A message may be files alone.
  const can = !busy && files.progress === null && (text.trim() !== '' || files.files.length > 0);
  const submit = async () => {
    if (can && (await send(text.trim()))) setText('');
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5 rounded-2xl border bg-card px-2 pt-2 pb-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <FileCards files={files} disabled={busy || files.progress !== null} />
        <Textarea
          value={text}
          rows={rows}
          aria-label={placeholder}
          placeholder={placeholder}
          className="min-h-0 resize-none border-0 p-1 shadow-none focus-visible:ring-0"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex items-center gap-0.5">
          <AttachButton files={files} disabled={busy} />
          {tools}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
            {children}
            {stop ? (
              <Button type="button" size="icon" className="size-7 rounded-full" aria-label={t('stop')} title={t('stop')} disabled={stop.disabled} onClick={stop.run}>
                <Square className="fill-current" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" size="icon" className="size-7 rounded-full" aria-label={t('send')} title={t('send')} disabled={!can}>
                <ArrowUp aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * The DSH asks for this member's PIN: set a first one, typed twice, or give it. Only the DSH checks it. Drawn as the
 * phone app's PIN lock is: a lock on its tile and four rings, the fourth digit sending it. `enterHint` words the ask
 * for a PIN where a page's computer has its own (an edition's cloud computer, whose PIN is the server's).
 */
export function PinGate({ computerId, state, lockedHint, enterHint }: { computerId: string; state: PinState | undefined; lockedHint: string; enterHint?: string }) {
  const t = useTranslations('team.dsh.pin');
  const relay = useSessionClient();
  const [value, setValue] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'mismatch' | 'unavailable' | null>(null);
  const prompt = pinPrompt(state, first !== null);
  if (!prompt) return null;

  async function submit(pin: string) {
    if (pin.length !== 4 || busy) return;
    if (prompt === 'set') { setFirst(pin); setValue(''); return; }
    if (prompt === 'confirm' && pin !== first) { setFirst(null); setValue(''); setFailed('mismatch'); return; }
    setBusy(true);
    setFailed(null);
    try {
      if (prompt === 'confirm') await relay.setPin(computerId, pin);
      else await relay.unlock(computerId, pin);
    } catch {
      setFailed('unavailable');
    } finally {
      setBusy(false);
      setValue('');
      setFirst(null);
    }
  }

  const hint = state?.kind === 'wrong' ? t('wrong', { count: state.left }) : prompt === 'locked' ? lockedHint : prompt === 'enter' && enterHint ? enterHint : t(`${prompt}.hint`);
  return (
    <CodePrompt icon={Lock} title={t(`${prompt}.title`)} hint={hint}>
      {prompt !== 'locked' && (
        <>
          <CodeSlots
            // A new key for each step, so the field takes the focus again for the second PIN.
            key={prompt}
            label={t(`${prompt}.title`)}
            length={4}
            secret
            value={value}
            disabled={busy}
            onChange={(raw) => {
              const pin = raw.replace(/\D/g, '').slice(0, 4);
              setValue(pin);
              if (pin.length === 4) void submit(pin);
            }}
          />
          {busy && <Loader className="size-5 animate-spin text-muted-foreground" aria-hidden />}
          {failed && <p role="alert" className="text-sm text-destructive">{t(failed)}</p>}
        </>
      )}
    </CodePrompt>
  );
}


/** An artifact the agent published in this conversation: a card that opens it. */
function ArtifactCard({ artifact, onOpen }: { artifact: PublishedArtifact; onOpen: () => void }) {
  const t = useTranslations('team.artifacts');
  const Icon = KIND_ICON[artifact.kind];
  return (
    <button type="button" onClick={onOpen} className="flex max-w-md items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-ring">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{artifact.title}</span>
        <span className="text-xs text-muted-foreground">{t('cardNote', { n: artifact.version })}</span>
      </span>
    </button>
  );
}
