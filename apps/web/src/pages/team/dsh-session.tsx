/**
 * What the console's pages for reaching a DSH share (Team DSH, team-dsh.tsx; My DSH, my-dsh.tsx): the two columns
 * beside the sidebar, a computer's sessions (grouped as DSH's own sidebar groups them) and PIN as its DSH reports them
 * through the relay, the conversation (a new
 * session included, which keeps its view as it starts), the composer laid out as DSH's own input bar, and the PIN gate. Everything here runs over `@/lib/relay`, end to end encrypted to the DSH, unless the page
 * provides another `SessionClient` (`SessionClientContext`): an edition's server may reach a computer itself.
 */

import { Archive, ArchiveRestore, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Ellipsis, FileText, Folder, FolderOpen, Loader, MessagesSquare, Paperclip, PencilLine, Pin, PinOff, Plus, Search, Server, ShieldAlert, ShieldCheck, Square, X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import Markdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import {
  applySessionEvent,
  defaultDirectory,
  deliverFiles,
  imageMediaType,
  EMPTY_SESSION,
  fileReference,
  toolKey,
  ensureFileTarget,
  fileSize,
  newFileDraft,
  uploadFiles,
  validateFiles,
  type PickedFile,
  type UploadLimits,
  isThinking,
  directoryName,
  pinPrompt,
  RelayError,
  rowsOf,
  searchSessions,
  sessionGroups,
  type ModelSelection,
  type PinState,
  type RelayClient,
  type RelayErrorCode,
  type SessionConfiguration,
  type SessionOptions,
  type SessionState,
  type SessionSummary,
} from '@dsh-teamwork/relay-client';
import type { PublishedPage } from '@dsh-teamwork/relay-client';
import { KIND_ICON, PageViewer } from '@/components/page-viewer';
import { PresetAvatar } from '@/components/preset-avatar';
import { ProviderMark } from '@/components/provider-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { relayFor } from '@/lib/relay';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';
import { SessionFiles, type FileTarget } from './session-files';

/** What the session parts speak to: a computer's sessions and its PIN. */
export type SessionClient = Pick<
  RelayClient,
  | 'listSessions' | 'watchSessions' | 'follow' | 'older' | 'createSession' | 'configuration' | 'selectModel'
  | 'uploadCapabilities' | 'startUpload' | 'uploadChunk' | 'finishUpload' | 'cancelUpload' | 'cancel' | 'prompt' | 'answer'
  | 'renameSession' | 'pinSession' | 'archiveSession' | 'selectPermission' | 'listFiles' | 'searchFiles' | 'readFile'
  | 'watchPin' | 'unlock' | 'setPin'
>;

/** A client a page provides in place of this browser's relay, for computers it reaches another way. */
export const SessionClientContext = createContext<SessionClient | null>(null);

function useSessionClient(): SessionClient {
  const { me } = useTeam();
  return useContext(SessionClientContext) ?? relayFor(me);
}

const WORDED = new Set(['file_type', 'file_name', 'file_too_large', 'image_too_large', 'image_model_unsupported', 'invalid_upload', 'upload_expired', 'upload_failed', 'upload_cancelled', 'upload_unsupported', 'send_uncertain', 'offline', 'not_found', 'busy', 'stale', 'locked', 'invite_refused', 'device_key_changed', 'device_verification_required', 'no_directory', 'not_authenticated', 'missing_tools', 'missing_plugins', 'preset_unavailable', 'model_unavailable', 'invalid_request', 'permission_refused', 'not_text']);

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
  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-72 md:shrink-0 md:border-r md:border-b-0 md:px-3">
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
      {/* A session's files panel (session-files.tsx) takes the right of a wide screen: the conversation moves over for it. */}
      <section className="mx-auto flex w-full max-w-4xl min-w-0 flex-1 flex-col gap-5 px-4 pt-6 md:px-8 md:pt-6 md:has-[[data-files-panel]]:mr-[min(36rem,45vw)]">{children}</section>
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
 * A computer's sessions in the column: a new session and a search above them, then the sessions grouped as DSH's own
 * sidebar groups them (`sessionGroups`: each workspace in DSH's order, then Ungrouped, pinned first in each), each
 * group folding away under its name; while searching, the matches in one list instead. Archived sessions are hidden
 * until asked for, and then shown in their groups; the open one stays listed either way. `unavailable` says why none
 * can be listed yet (the computer offline, not paired, locked), and nothing can be started or searched meanwhile.
 * Each row has DSH's own actions that fit a browser (pin, rename, copy its id, archive), once the computer's plugin
 * marks its list (`SessionSummary.marks`); an older one offers only the copy.
 */
export function SessionList({ computerId, base, unavailable, sessions, sessionId, onPick }: { computerId: string; base: string; unavailable?: string; sessions: SessionSummary[] | null; sessionId: string; onPick: () => void }) {
  const t = useTranslations('team.dsh');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const list = sessions ?? [];
  const archived = list.filter((s) => s.marks?.archived).length;
  // The open session stays listed when it is archived and the rest are not.
  const listed = showArchived ? list : list.filter((s) => !s.marks?.archived || s.id === sessionId);
  const item = (s: SessionSummary) => <SessionRow key={s.id} computerId={computerId} base={base} session={s} open={s.id === sessionId} onPick={onPick} />;
  const fold = (key: string) => setFolded((was) => {
    const next = new Set(was);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const found = query.trim() ? searchSessions(listed, query, true) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
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
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} disabled={!!unavailable} className="h-8 pl-8 text-sm" />
      </div>
      <nav aria-label={t('sessions')} className="scrollbar-quiet -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
        {unavailable ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{unavailable}</p>
        ) : found ? (
          found.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('noMatches')}</p> : found.map(item)
        ) : (
          <>
            {sessions !== null && listed.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('noSessions')}</p>}
            {sessionGroups(listed, true).map((group) => {
              const key = group.workspace?.id ?? '';
              const name = group.workspace?.title ?? t('ungrouped');
              const open = !folded.has(key);
              return (
                <div key={key} className="flex flex-col gap-0.5">
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
        {!unavailable && archived > 0 && (
          <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)} className={cn(row, 'mt-1 gap-2 text-xs text-muted-foreground')}>
            <Archive className="size-3.5" aria-hidden />
            {t(showArchived ? 'hideArchived' : 'showArchived', { count: archived })}
          </button>
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
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
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

/**
 * A computer's row in the column: its name, and under it whether it is online (`online`, when known; green, or grey and
 * dimmed when offline) and `note`.
 */
export function ComputerRow({ icon: Icon = Server, name, note, online, to, open, current, onPick }: { icon?: LucideIcon; name: string; note?: string; online?: boolean; to?: string; open?: boolean; current?: boolean; onPick?: () => void }) {
  const inner = (
    <>
      <Icon className={cn('size-4 shrink-0', online === false && 'text-muted-foreground')} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate', online === false && 'text-muted-foreground')}>{name}</span>
        <span className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
          {online !== undefined && <Presence online={online} />}
          {online !== undefined && note && <span aria-hidden>·</span>}
          {note && <span className="truncate">{note}</span>}
        </span>
      </span>
    </>
  );
  return to ? (
    <Link to={to} onClick={onPick} aria-current={current ? 'page' : undefined} className={cn(row, 'gap-2.5', current && selected, open && 'font-medium')}>
      {inner}
    </Link>
  ) : (
    <div className={cn(row, 'gap-2.5 text-muted-foreground hover:bg-transparent')}>{inner}</div>
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
export function Conversation({ computerId, sessionId, title, name, started }: { computerId: string; sessionId: string; title: string; name: string; started: (sessionId: string) => void }) {
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
      started={(id) => {
        setBorn(id);
        started(id);
      }}
    />
  );
}

/** One session's view: its conversation, what it waits on the member for, and the composer, centred until it starts. */
function SessionView({ computerId, sessionId, title, name, started }: { computerId: string; sessionId: string; title: string; name: string; started: (sessionId: string) => void }) {
  const { team } = useTeam();
  const t = useTranslations('team.dsh');
  const word = useRelayError();
  const relay = useSessionClient();
  // The session's id, from the address, or once its first message started it.
  const [id, setId] = useState(sessionId);
  const [state, setState] = useState<SessionState>(EMPTY_SESSION);
  const [options, setOptions] = useState<SessionOptions>({});
  const [config, setConfig] = useConfiguration(computerId, id);
  const files = useFiles(computerId);
  // The first message, shown until the session's own copy of it arrives.
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<PublishedPage | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileOpened, setFileOpened] = useState<FileTarget | null>(null);
  // A file the conversation names opens in the files column, where the computer's plugin can read it.
  const openFile = config?.files && id ? (target: FileTarget) => { setFileOpened(target); setFilesOpen(true); } : undefined;

  useEffect(() => (id ? relay.follow(computerId, id, (event) => setState((s) => applySessionEvent(s, event))) : undefined), [relay, computerId, id]);

  const rows = rowsOf(state.items);
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
            {id && config?.files && (
              <Button type="button" variant="outline" size="sm" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}>
                <FolderOpen aria-hidden />
                {t('browse.open')}
              </Button>
            )}
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
          {rows.map((row) =>
            row.kind === 'user' ? (
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
                {row.text && <p className="rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.text}</p>}
              </div>
            ) : row.kind === 'page' ? (
              <PageCard key={row.id} page={row.page} onOpen={() => setOpenPage(row.page)} />
            ) : row.kind === 'assistant' ? (
              <div key={row.id} className="flex flex-col gap-2 leading-6 [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
                <Markdown remarkPlugins={[remarkGfm]} skipHtml components={openFile && fileLinks(openFile)}>{row.text}</Markdown>
              </div>
            ) : row.kind === 'failed' ? (
              <p key={row.id} role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-destructive [overflow-wrap:anywhere]">
                {row.noModel ? t('noModel') : t('turnFailed', { message: row.message })}
              </p>
            ) : (
              <details key={row.id} className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                <summary>{t('steps', { count: row.tools.length })}{row.status === 'running' ? ` · ${t('running')}` : row.status === 'done' ? '' : ` · ${t(row.status)}`}</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {row.tools.map((tool) => {
                    // A step that read, wrote or edited a file opens it.
                    const file = openFile && ['tools.read', 'tools.write', 'tools.edit'].includes(toolKey(tool.name) ?? '') ? fileReference(tool.summary) : null;
                    return (
                      <li key={tool.id} className="truncate font-mono">
                        {tool.name}{' '}
                        {file ? <button type="button" className={fileLink} onClick={() => openFile!(file)}>{tool.summary}</button> : tool.summary}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ),
          )}
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
          {filesOpen && id && (
            <SessionFiles client={relay} computerId={computerId} sessionId={id} items={state.items} word={word}
              opened={fileOpened} onOpen={setFileOpened} onClose={() => { setFilesOpen(false); setFileOpened(null); }} />
          )}
          {openPage && (
            // Beside the conversation on a wide screen, over it on a narrow one (docs/tech/pages.md, "The clients").
            <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto border-l bg-background p-4 shadow-xl xl:w-[min(60rem,55vw)]">
              <PageViewer key={`${openPage.pageId}-${openPage.version}`} teamId={openPage.teamId} pageId={openPage.pageId} version={openPage.version} onClose={() => setOpenPage(null)} />
            </aside>
          )}
        </div>
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
 * (one that leaves the workspace's sandbox or skips approval) is confirmed once; one its computer keeps to its own
 * keyboard (a Team DSH's risky ones) is shown and cannot be picked.
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
  const options = permissions.options.map((option) => ({
    value: option.id,
    label: option.allowed ? nameOf(option) : t('keyboardOnly', { name: nameOf(option) }),
    disabled: !option.allowed,
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
            {!!model?.reasoning?.efforts.length && (
              <>
                <DropdownMenu.RadioGroup aria-label={t('effort')} value={chosen?.reasoningEffort ?? ''} onValueChange={(effort) => void choose({
                  provider: model.provider, model: model.id, ...(effort ? { reasoningEffort: effort } : {}),
                })}>
                  <DropdownMenu.Label className={heading}>{t('effort')}</DropdownMenu.Label>
                  {[{ id: '', name: t('effortDefault') }, ...model.reasoning.efforts].map((effort) => (
                    <DropdownMenu.RadioItem key={effort.id} value={effort.id} className={option} disabled={disabled || saving}
                      onSelect={(event) => event.preventDefault()}>
                      {effort.name}
                      {indicator}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              </>
            )}
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
                          {item.id !== item.name && <span className="block text-xs text-muted-foreground">{item.id}</span>}
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

/** The DSH asks for this member's PIN: set a first one, typed twice, or give it. Only the DSH checks it. */
export function PinGate({ computerId, state, lockedHint, enterHint }: { computerId: string; state: PinState | undefined; lockedHint: string; enterHint?: string }) {
  const t = useTranslations('team.dsh.pin');
  const relay = useSessionClient();
  const [value, setValue] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'mismatch' | 'unavailable' | null>(null);
  const prompt = pinPrompt(state, first !== null);
  if (!prompt) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (value.length !== 4 || busy) return;
    if (prompt === 'set') { setFirst(value); setValue(''); return; }
    if (prompt === 'confirm' && value !== first) { setFirst(null); setValue(''); setFailed('mismatch'); return; }
    setBusy(true);
    setFailed(null);
    try {
      if (prompt === 'confirm') await relay.setPin(computerId, value);
      else await relay.unlock(computerId, value);
    } catch {
      setFailed('unavailable');
    } finally {
      setBusy(false);
      setValue('');
      setFirst(null);
    }
  }

  return (
    <Card className="m-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t(`${prompt}.title`)}</CardTitle>
        <CardDescription>{state?.kind === 'wrong' ? t('wrong', { count: state.left }) : prompt === 'locked' ? lockedHint : prompt === 'enter' && enterHint ? enterHint : t(`${prompt}.hint`)}</CardDescription>
      </CardHeader>
      {prompt !== 'locked' && (
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <Input
              aria-label={t(`${prompt}.title`)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={4}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 4))}
              className="text-center font-mono text-2xl tracking-[0.5em]"
            />
            {failed && <p role="alert" className="text-sm text-destructive">{t(failed)}</p>}
            <Button type="submit" disabled={busy || value.length !== 4}>{t('submit')}</Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}

const fileLink = 'cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid';

/**
 * A reply's file names as links to the files column: inline code that reads as a path (`src/app.ts:42`), and a link
 * to a local file. A web address stays a link that opens in a new tab.
 */
function fileLinks(openFile: (target: FileTarget) => void): Components {
  return {
    code({ className, children, ...props }) {
      const text = typeof children === 'string' ? children : '';
      const file = !className && !text.includes('\n') ? fileReference(text) : null;
      if (!file) return <code className={className} {...props}>{children}</code>;
      return <button type="button" className={cn('font-mono', fileLink)} onClick={() => openFile(file)}>{children}</button>;
    },
    a({ href = '', children, node: _node, ...props }) {
      const file = fileReference(href);
      if (file) return <button type="button" className={fileLink} onClick={() => openFile(file)}>{children}</button>;
      return <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2" {...props}>{children}</a>;
    },
  };
}

/** A page the agent published in this conversation: a card that opens it. */
function PageCard({ page, onOpen }: { page: PublishedPage; onOpen: () => void }) {
  const t = useTranslations('team.pages');
  const Icon = KIND_ICON[page.kind];
  return (
    <button type="button" onClick={onOpen} className="flex max-w-md items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-ring">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{page.title}</span>
        <span className="text-xs text-muted-foreground">{t('cardNote', { n: page.version })}</span>
      </span>
    </button>
  );
}
