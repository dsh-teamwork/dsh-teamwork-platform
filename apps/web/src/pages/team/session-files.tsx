/**
 * A session's files in its right sidebar (docs/tech/relay.md, "The allow-list"), drawn as DSH's own
 * (`ui-sidebar-files` and `ui-sidebar-documentpreview` in DeepSeek Harness): the Files tab, a tree of the working
 * directory searchable by name, and a file's tab, its path bar above it (the absolute path with the name in full ink,
 * the renderer, wrapping, reload and the tree beside it) and its body by kind: a PDF, an Office file or a workbook in
 * the sandboxed preview, Markdown rendered, HTML in a frame that runs nothing, code coloured with its line numbers,
 * anything else as text. The plugin reads them under that directory alone; nothing here writes.
 */

import { Check, ChevronDown, Copy, Eye, EyeOff, FolderClosed, FolderOpen, RefreshCw, Search, WrapText, X } from 'lucide-react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ThemedToken } from 'shiki';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { documentPreviewKind, RelayError, type FileText as Text, type FolderListing } from '@dsh-teamwork/relay-client';
import { baseName, classifyFileType, FileTypeIcon } from '@/components/file-type-icon';
import { highlight } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { SessionMarkdown } from './session-markdown';
import { IconButton } from './session-sidebar';

const SessionDocumentPreview = lazy(() => import('./session-document-preview'));

/** What the sidebar reads with: the computer's client, held to the calls it needs. */
export interface FilesClient {
  listFiles(computerId: string, sessionId: string, path: string): Promise<FolderListing>;
  searchFiles(computerId: string, sessionId: string, query: string): Promise<{ matches: string[]; truncated: boolean }>;
  readDocument(computerId: string, sessionId: string, path: string, signal?: AbortSignal): Promise<Uint8Array>;
  readFile(computerId: string, sessionId: string, path: string): Promise<Text>;
}

/** A file to show, from the tree or from the conversation; `line` is where to open it. */
export interface FileTarget { path: string; line?: number }

interface Source {
  client: FilesClient;
  computerId: string;
  sessionId: string;
  /** The session's working directory on its computer, which the paths here are under. */
  root?: string;
  word: (error: unknown) => string;
}

/** `path` as the computer names it: under the working directory unless it is absolute already. */
function absolute(root: string | undefined, path: string) {
  if (!root || path.startsWith('/') || /^[a-z]:[\\/]/i.test(path)) return path;
  return `${root.replace(/[\\/]+$/, '')}/${path}`;
}

/** Folders first, then by name as a person reads numbers (`file2` before `file10`). */
function sortEntries<T extends { name: string; kind: 'file' | 'directory' }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'directory' ? -1 : 1));
}

/**
 * A path in 12px on one line: the folder in muted ink, the name in full. Clipped, it holds to its end, so the name
 * stays in view, and fades in at the start; the whole path is its tooltip, and its menu copies it.
 */
function PathLabel({ path }: { path: string }) {
  const t = useTranslations('team.dsh.sidebar');
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // The text's own width against the box's, which holds whichever end is shown.
    const measure = () => setClipped((inner.current?.offsetWidth ?? 0) > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [path]);
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const copy = () => {
    void navigator.clipboard.writeText(path).then(() => toast.success(t('pathCopied')), () => toast.error(t('copyFailed')));
  };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <span ref={box} title={path}
          className={cn('mr-3 flex min-w-0 flex-1 overflow-hidden text-xs whitespace-nowrap', clipped && 'justify-end [mask-image:linear-gradient(to_right,transparent,#000_28px)]')}>
          <span ref={inner} className="shrink-0">
            <span className="text-muted-foreground">{path.slice(0, cut)}</span>
            <span className="text-foreground">{path.slice(cut)}</span>
          </span>
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-40 rounded-lg border bg-card p-1 text-[12px] text-card-foreground shadow-lg">
          <ContextMenu.Item onSelect={copy} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent">
            <Copy className="size-3.5" aria-hidden />
            {t('copyPath')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The 38px bar under a tab's strip, which with it lines up with the conversation's header. */
function Bar({ children }: { children: ReactNode }) {
  return <div className="flex h-[38px] shrink-0 items-center gap-1 border-b-[0.5px] border-border pr-1.5 pl-4">{children}</div>;
}

/** A body still reading: DSH's pulsing dot and a line. */
function Loading() {
  const t = useTranslations('team.dsh.sidebar');
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
      <span className="relative flex size-7 items-center justify-center">
        <span className="absolute size-3 animate-ping rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground" />
      </span>
      {t('loading')}
    </div>
  );
}

/** A body that has nothing to show: the file's kind in grey, why, and, where trying again could help, Retry. */
function Notice({ path, message, retry }: { path: string; message: string; retry?: () => void }) {
  const t = useTranslations('team.dsh.sidebar');
  return (
    <div role={retry ? 'alert' : undefined} className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-[6%] text-center">
      <FileTypeIcon path={path} size={36} className="opacity-60 grayscale" />
      <p className="max-w-xs text-sm text-muted-foreground [overflow-wrap:anywhere]">{message}</p>
      {retry && (
        <button type="button" onClick={retry} className="h-8 rounded-xl border px-4 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {t('retry')}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The tree

type Node = { name: string; path: string; kind: 'file' | 'directory'; children?: Node[] };

/** Search matches as a tree: every folder on the way to a match, open. */
function treeOf(paths: readonly string[]): Node[] {
  const root: Node = { name: '', path: '', kind: 'directory', children: [] };
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let at = root;
    parts.forEach((part, index) => {
      const full = parts.slice(0, index + 1).join('/');
      const kind = index === parts.length - 1 ? 'file' : 'directory';
      let child = at.children!.find((node) => node.name === part && node.kind === kind);
      if (!child) {
        child = { name: part, path: full, kind, children: kind === 'directory' ? [] : undefined };
        at.children!.push(child);
      }
      at = child;
    });
  }
  const sort = (nodes: Node[]): Node[] => sortEntries(nodes).map((node) => ({ ...node, children: node.children && sort(node.children) }));
  return sort(root.children!);
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="rounded-sm bg-brand/15 text-inherit">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

const row = 'flex w-full min-w-0 items-center gap-1.5 rounded-xl py-[5px] pr-2.5 text-left text-[13px] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * The working directory as a tree, each folder read as it opens, folders first; a name starting with a dot hidden
 * until `hidden`; the file in `current` revealed and marked. With `query`, the computer's matches instead, as a tree.
 */
function FileTree({ source, current, hidden, query, reload, onOpen }: {
  source: Source;
  current?: string;
  hidden: boolean;
  query: string;
  reload: number;
  onOpen: (path: string) => void;
}) {
  const t = useTranslations('team.dsh.sidebar');
  const { client, computerId, sessionId, word } = source;
  const [folders, setFolders] = useState<Record<string, FolderListing | { failed: string } | undefined>>({});
  const ancestors = useMemo(() => {
    const parts = (current ?? '').split('/').filter(Boolean).slice(0, -1);
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  }, [current]);
  const [open, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set(['', ...ancestors]));
  const [found, setFound] = useState<{ query: string; matches: string[]; truncated: boolean } | { query: string; failed: string } | null>(null);

  const read = useCallback((path: string) => {
    setFolders((f) => ({ ...f, [path]: undefined }));
    client.listFiles(computerId, sessionId, path).then(
      (listing) => setFolders((f) => ({ ...f, [path]: listing })),
      (error) => setFolders((f) => ({ ...f, [path]: { failed: word(error) } })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId]);

  // The open folders are read again on a reload; a folder opened later is read as it opens.
  useEffect(() => {
    for (const path of open) read(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a reload reads every open folder again.
  }, [read, reload]);

  // A file revealed later opens the folders down to it.
  useEffect(() => {
    const missing = ancestors.filter((path) => !open.has(path));
    if (!missing.length) return;
    setOpenFolders(new Set([...open, ...missing]));
    for (const path of missing) if (!(path in folders)) read(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new current file reveals.
  }, [ancestors]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) return setFound(null);
    let live = true;
    // Typing settles before the computer walks its folders.
    const timer = setTimeout(() => {
      client.searchFiles(computerId, sessionId, needle).then(
        (result) => { if (live) setFound({ query: needle, ...result }); },
        (error) => { if (live) setFound({ query: needle, failed: word(error) }); },
      );
    }, 300);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, query, reload]);

  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!(path in folders) || (folders[path] && 'failed' in folders[path]!)) read(path);
    }
    setOpenFolders(next);
  };

  const visible = (name: string) => hidden || !name.startsWith('.');
  const indent = (depth: number) => ({ paddingLeft: 10 + depth * 12 });
  const fileRow = (path: string, name: string, depth: number, needle = '') => (
    <button key={path} type="button" className={cn(row, path === current && 'bg-secondary')} aria-current={path === current ? 'true' : undefined}
      style={indent(depth)} title={path} onClick={() => onOpen(path)}>
      <FileTypeIcon path={name} size={16} />
      <span className="min-w-0 truncate"><Highlighted text={name} query={needle} /></span>
    </button>
  );
  const folderRow = (path: string, name: string, depth: number, expanded: boolean, onClick?: () => void, needle = '') => (
    <button key={`d:${path}`} type="button" className={row} style={indent(depth)} aria-expanded={expanded} onClick={onClick}>
      {expanded ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <FolderClosed className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 truncate"><Highlighted text={name} query={needle} /></span>
    </button>
  );

  const needle = query.trim();
  if (needle) {
    if (!found || found.query !== needle) return <Loading />;
    if ('failed' in found) return <p role="alert" className="px-4 py-2 text-sm text-destructive">{found.failed}</p>;
    const shownMatches = found.matches.filter((path) => path.split('/').every(visible));
    const draw = (nodes: Node[], depth: number): ReactNode[] => nodes.flatMap((node) => node.kind === 'directory'
      ? [folderRow(node.path, node.name, depth, true, undefined, needle), ...draw(node.children ?? [], depth + 1)]
      : [fileRow(node.path, node.name, depth, needle)]);
    return (
      <div className="flex flex-col gap-px p-1.5">
        <p className="px-2.5 pb-1 text-xs text-muted-foreground">
          {shownMatches.length === 0 ? t('noMatches') : t('matches', { count: shownMatches.length })}
          {found.truncated && ` · ${t('moreMatches')}`}
        </p>
        {draw(treeOf(shownMatches), 0)}
      </div>
    );
  }

  const draw = (path: string, depth: number): ReactNode[] => {
    const folder = folders[path];
    if (folder === undefined) return [<Loading key={`l:${path}`} />].slice(0, depth === 0 ? 1 : 0);
    if ('failed' in folder) return [<p key={`f:${path}`} role="alert" className="py-1 text-xs text-destructive" style={indent(depth)}>{folder.failed}</p>];
    const rows = sortEntries(folder.entries).filter((entry) => visible(entry.name)).flatMap((entry) => {
      const full = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind !== 'directory') return [fileRow(full, entry.name, depth)];
      const expanded = open.has(full);
      return [folderRow(full, entry.name, depth, expanded, () => toggle(full)), ...(expanded ? draw(full, depth + 1) : [])];
    });
    if (depth === 0 && rows.length === 0) rows.push(<p key="empty" className="px-2.5 py-2 text-sm text-muted-foreground">{t('emptyFolder')}</p>);
    if (folder.truncated) rows.push(<p key={`t:${path}`} className="py-1 text-xs text-muted-foreground" style={indent(depth)}>{t('moreEntries')}</p>);
    return rows;
  };
  return <div className="flex flex-col gap-px p-1.5">{draw('', 0)}</div>;
}

/** The tree's own controls: the search field, dotfiles. */
function TreeTools({ query, setQuery, hidden, setHidden }: { query: string; setQuery: (query: string) => void; hidden: boolean; setHidden: (hidden: boolean) => void }) {
  const t = useTranslations('team.dsh.sidebar');
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
      <label className="relative flex h-8 min-w-0 flex-1 items-center rounded-lg border-[0.5px] border-border bg-background focus-within:ring-2 focus-within:ring-ring">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')}
          className="h-full min-w-0 flex-1 bg-transparent pr-7 pl-8 text-[13px] outline-none" />
        {query && (
          <button type="button" aria-label={t('clearSearch')} onClick={() => setQuery('')} className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </label>
      <IconButton label={hidden ? t('hideHidden') : t('showHidden')} pressed={hidden} onClick={() => setHidden(!hidden)}>
        {hidden ? <Eye className="size-[15px]" aria-hidden /> : <EyeOff className="size-[15px]" aria-hidden />}
      </IconButton>
    </div>
  );
}

/** The Files tab: the working directory's path, its tree and a search of its names. */
export function FilesPage({ reload, onReload, onOpen, ...source }: Source & { reload: number; onReload: () => void; onOpen: (path: string) => void }) {
  const t = useTranslations('team.dsh.sidebar');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Bar>
        <PathLabel path={source.root ?? t('workspace')} />
        <IconButton label={t('reload')} onClick={onReload}><RefreshCw className="size-[15px]" aria-hidden /></IconButton>
      </Bar>
      <TreeTools query={query} setQuery={setQuery} hidden={hidden} setHidden={setHidden} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree source={source} hidden={hidden} query={query} reload={reload} onOpen={onOpen} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A file

type View = 'pdf' | 'workbook' | 'markdown' | 'html' | 'code' | 'text';

/** Kinds no renderer here reads: the plugin sends text and documents, not these. */
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|heif|avif|mp4|mov|m4v|webm|mkv|avi|mp3|wav|flac|ogg|m4a|zip|tar|gz|tgz|bz2|xz|7z|rar|exe|dll|so|dylib|bin|o|a|class|jar|wasm|ttf|otf|woff2?|eot|psd|ai|sketch|fig|sqlite|db|key|pages|numbers)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|heif|avif)$/i;

/** The renderers that can draw `path`, the first being the one it opens in. */
function viewsOf(path: string): View[] {
  const document = documentPreviewKind(path);
  if (document) return [document];
  const kind = classifyFileType(path);
  if (kind === 'markdown') return ['markdown', 'text'];
  if (kind === 'html') return ['html', 'code'];
  if (kind === 'code' || kind === 'excel' || /\.(xml|svg)$/i.test(path)) return ['code', 'text'];
  return ['text'];
}

/** One file's tab: its path bar, its body, and the tree beside it on demand. */
export function FileView({ path, line, reload, onReload, onOpen, ...source }: Source & {
  path: string;
  line?: number;
  reload: number;
  onReload: () => void;
  /** A file picked in the tree beside this one, which takes this tab. */
  onOpen: (path: string) => void;
}) {
  const t = useTranslations('team.dsh.sidebar');
  const views = viewsOf(path);
  const [view, setView] = useState<View>(views[0]!);
  const [wrap, setWrap] = useState(true);
  const [navigator, setNavigator] = useState(false);
  const wraps = view === 'code' || view === 'text';
  const binary = BINARY.test(path);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Bar>
        <PathLabel path={absolute(source.root, path)} />
        {views.length > 1 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="flex h-7 max-w-40 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="truncate">{t(`views.${view}`)}</span>
              <ChevronDown className="size-3 shrink-0" aria-hidden />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-36 rounded-lg border bg-card p-1 text-[12px] text-card-foreground shadow-lg">
                {views.map((option) => (
                  <DropdownMenu.Item key={option} onSelect={() => setView(option)} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent">
                    <Check className={cn('size-3.5', option !== view && 'invisible')} aria-hidden />
                    {t(`views.${option}`)}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        {wraps && !binary && (
          <IconButton label={wrap ? t('noWrap') : t('wrap')} pressed={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText className="size-[15px]" aria-hidden />
          </IconButton>
        )}
        <IconButton label={t('reload')} onClick={onReload}><RefreshCw className="size-[15px]" aria-hidden /></IconButton>
        <IconButton label={navigator ? t('hideTree') : t('showTree')} pressed={navigator} onClick={() => setNavigator(!navigator)}>
          {navigator ? <FolderOpen className="size-[15px]" aria-hidden /> : <FolderClosed className="size-[15px]" aria-hidden />}
        </IconButton>
      </Bar>
      <Navigated open={navigator} onClose={() => setNavigator(false)}
        tree={<FileTree source={source} current={path} hidden={false} query="" reload={reload} onOpen={(next) => onOpen(next)} />}>
        {binary ? (
          <Notice path={path} message={IMAGE.test(path) ? t('imageUnsupported') : t('unsupported')} />
        ) : view === 'pdf' || view === 'workbook' ? (
          <DocumentBody key={reload} source={source} path={path} workbook={view === 'workbook'} />
        ) : (
          <TextBody key={reload} source={source} path={path} line={line} view={view} wrap={wrap} />
        )}
      </Navigated>
    </div>
  );
}

/** Navigator widths, as DSH's (`navigator-layout.ts`). */
const TREE_WIDTH = 260;
const TREE_MIN = 180;

/**
 * A body with the tree beside it: a raised panel on its right where the row is 560px or wider, over its right edge
 * from 400px, and over all of it below that. Escape closes it.
 */
function Navigated({ open, onClose, tree, children }: { open: boolean; onClose: () => void; tree: ReactNode; children: ReactNode }) {
  const t = useTranslations('team.dsh.sidebar');
  const box = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [width, setWidth] = useState(TREE_WIDTH);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setRowWidth(el.clientWidth));
    observer.observe(el);
    setRowWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, [open, onClose]);
  const mode = rowWidth >= 560 ? 'beside' : rowWidth >= 400 ? 'over' : 'fill';
  const shown = Math.min(width, Math.max(TREE_MIN, rowWidth - 240));
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const from = shown;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setWidth(Math.max(TREE_MIN, from + start - e.clientX));
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return (
    <div ref={box} className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {open && (
        <nav aria-label={t('tree')}
          style={mode === 'fill' ? undefined : { width: shown }}
          className={cn(
            'z-20 flex min-h-0 flex-col overflow-hidden bg-card',
            mode === 'beside' && 'relative m-2 shrink-0 rounded-lg border-[0.5px] border-border shadow-md',
            mode === 'over' && 'absolute inset-y-2 right-2 rounded-lg border-[0.5px] border-border shadow-lg',
            mode === 'fill' && 'absolute inset-0',
          )}
        >
          {mode !== 'fill' && (
            <div role="separator" aria-orientation="vertical" aria-label={t('resizeTree')} onPointerDown={resize}
              className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize" />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{tree}</div>
        </nav>
      )}
    </div>
  );
}

/** A PDF, an Office file the computer turns into one, or a workbook, read whole and drawn in the sandboxed preview. */
function DocumentBody({ source, path, workbook }: { source: Source; path: string; workbook: boolean }) {
  const { client, computerId, sessionId, word } = source;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setBytes(null);
    setFailed(null);
    client.readDocument(computerId, sessionId, path, controller.signal).then((read) => { if (live) setBytes(read); }, (error) => { if (live) setFailed(word(error)); });
    return () => { live = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, path, attempt]);
  if (failed) return <Notice path={path} message={failed} retry={() => setAttempt(attempt + 1)} />;
  if (!bytes) return <Loading />;
  return <Suspense fallback={<Loading />}><SessionDocumentPreview data={bytes} workbook={workbook} /></Suspense>;
}

/** A text file in the chosen renderer: Markdown, HTML, coloured code or plain text, `line` scrolled to and banded. */
function TextBody({ source, path, line, view, wrap }: { source: Source; path: string; line?: number; view: View; wrap: boolean }) {
  const t = useTranslations('team.dsh.sidebar');
  const { client, computerId, sessionId, word } = source;
  const [file, setFile] = useState<Text | null>(null);
  const [failed, setFailed] = useState<{ message: string; text: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(null);
    client.readFile(computerId, sessionId, path).then(
      (read) => { if (live) setFile(read); },
      (error) => { if (live) setFailed({ message: word(error), text: !(error instanceof RelayError && error.code === 'not_text') }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, path, attempt]);
  if (failed) return failed.text ? <Notice path={path} message={failed.message} retry={() => setAttempt(attempt + 1)} /> : <Notice path={path} message={t('unsupported')} />;
  if (!file) return <Loading />;
  const note = file.truncated && <p className="border-t-[0.5px] border-border px-3 py-2 text-xs text-muted-foreground">{t('truncated')}</p>;
  if (view === 'markdown') return <MarkdownBody text={file.text} note={note} />;
  if (view === 'html') return <HtmlBody text={file.text} title={baseName(path)} />;
  return <LinesBody text={file.text} path={path} line={line} code={view === 'code'} wrap={wrap} note={note} />;
}

/** A Markdown file rendered, its front matter as a box of keys and values above it. */
function MarkdownBody({ text, note }: { text: string; note: ReactNode }) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const fields = front?.[1]!.split(/\r?\n/).map((entry) => /^([^:#]+):\s*(.*)$/.exec(entry)).filter((match): match is RegExpExecArray => !!match) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-3 py-2.5 text-sm">
        {fields.length > 0 && (
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border-[0.5px] border-border bg-muted/50 px-3 py-2 text-xs">
            {fields.map((match, index) => (
              <div key={index} className="contents">
                <dt className="text-muted-foreground">{match[1]!.trim()}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{match[2]}</dd>
              </div>
            ))}
          </dl>
        )}
        <SessionMarkdown text={front ? text.slice(front[0].length) : text} passive />
      </div>
      {note}
    </div>
  );
}

/**
 * An HTML file drawn in a frame with no scripts and no origin, under a policy that lets it fetch nothing: what an agent
 * wrote is shown, never run, and cannot call home.
 */
function HtmlBody({ text, title }: { text: string; title: string }) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
  return <iframe title={title} sandbox="" srcDoc={policy + text} className="min-h-0 w-full flex-1 border-0 bg-white" />;
}

/** Text in lines: code coloured with its line numbers, plain text without; `line` scrolled to and banded. */
function LinesBody({ text, path, line, code, wrap, note }: { text: string; path: string; line?: number; code: boolean; wrap: boolean; note: ReactNode }) {
  const t = useTranslations('team.dsh.sidebar');
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  const [highlighted, setColoured] = useState<{ language: string; lines: ThemedToken[][] } | null>(null);
  const coloured = code ? highlighted : null;
  const marked = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!code) return;
    let live = true;
    void highlight(text, path).then((result) => { if (live) setColoured(result); }, () => {});
    return () => { live = false; };
  }, [code, text, path]);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center' });
  }, [line, text]);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t('copied')), () => toast.error(t('copyFailed')));
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {code && (
        <div className="sticky top-0 left-0 z-10 flex h-8 items-center justify-between bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur">
          <span>{coloured?.language ?? ''}</span>
          <button type="button" aria-label={t('copy')} title={t('copy')} onClick={copy} className="rounded-md p-1 hover:bg-accent hover:text-foreground">
            <Copy className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div className={cn('min-w-full font-mono text-xs leading-[1.6]', code ? 'w-max py-1' : 'w-max p-2', wrap && 'w-auto')}>
        {lines.map((content, index) => {
          const tokens = coloured?.lines[index];
          return (
            <div key={index} ref={index + 1 === line ? marked : undefined} className={cn('flex', index + 1 === line && 'session-line-band')}>
              {code && <span aria-hidden className="w-12 shrink-0 pr-4 text-right text-muted-foreground/70 tabular-nums select-none">{index + 1}</span>}
              <span className={cn('min-w-0 pr-3', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
                {tokens ? tokens.map((token, i) => <span key={i} className="shiki-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>) : content || ' '}
              </span>
            </div>
          );
        })}
      </div>
      {note}
    </div>
  );
}
