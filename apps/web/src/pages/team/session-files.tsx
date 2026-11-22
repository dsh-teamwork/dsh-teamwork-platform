/**
 * A session's files, beside its conversation (docs/tech/relay.md, "The allow-list"): what the session wrote or
 * edited, taken from its own tool calls (`touchedFiles`), and every folder and file under its working directory,
 * searchable by name, each text file opened read only. A file the conversation names opens here too (`opened`, from
 * `fileReference`), at its line when one is given. The plugin reads them under that directory alone; nothing here
 * writes. The panel is the right column of a wide screen, the conversation moving over for it (`DshColumns`), and
 * covers a narrow one.
 */

import { ArrowLeft, FileText, Folder, Loader, Search, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import { documentPreviewKind, fileSize, type ConversationItem, type FileText as Text, type FolderListing, touchedFiles } from '@dsh-teamwork/relay-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const SessionDocumentPreview = lazy(() => import('./session-document-preview'));

/** What the panel reads with: the computer's client, held to the calls it needs. */
export interface FilesClient {
  listFiles(computerId: string, sessionId: string, path: string): Promise<FolderListing>;
  searchFiles(computerId: string, sessionId: string, query: string): Promise<{ matches: string[]; truncated: boolean }>;
  readDocument(computerId: string, sessionId: string, path: string, signal?: AbortSignal): Promise<Uint8Array>;
  readFile(computerId: string, sessionId: string, path: string): Promise<Text>;
}

/** A file to show, from a list here or from the conversation; `line` is where to open it. */
export interface FileTarget { path: string; line?: number }

const item = 'flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function SessionFiles({ client, computerId, sessionId, items, word, opened, onOpen, onClose }: {
  client: FilesClient;
  computerId: string;
  sessionId: string;
  items: readonly ConversationItem[];
  word: (error: unknown) => string;
  /** The file shown, or null for the lists. */
  opened: FileTarget | null;
  onOpen: (target: FileTarget | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations('team.dsh.browse');
  const changed = touchedFiles(items);
  const [tab, setTab] = useState<'changes' | 'all'>(changed.length ? 'changes' : 'all');
  const setOpened = (path: string | null) => onOpen(path === null ? null : { path });

  return (
    <aside data-files-panel aria-label={t('title')} className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-xl md:w-[min(36rem,45vw)]">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="flex-1 font-semibold">{t('title')}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>
      {opened !== null ? (
        <Viewer key={`${opened.path}:${opened.line ?? ''}`} client={client} computerId={computerId} sessionId={sessionId} path={opened.path} line={opened.line} word={word} onBack={() => setOpened(null)} />
      ) : (
        <>
          <nav className="flex gap-1 border-b px-3 py-2 text-sm" aria-label={t('title')}>
            {(['changes', 'all'] as const).map((key) => (
              <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}
                className={cn('rounded-md px-3 py-1.5', tab === key ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent')}>
                {key === 'changes' ? t('changes', { count: changed.length }) : t('all')}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tab === 'changes' ? (
              changed.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('noChanges')}</p>
              ) : (
                changed.map((path) => (
                  <button key={path} type="button" className={item} title={path} onClick={() => setOpened(path)}>
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono text-xs">{path}</span>
                  </button>
                ))
              )
            ) : (
              <Browser client={client} computerId={computerId} sessionId={sessionId} word={word} onOpen={setOpened} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** The working directory's folders, one at a time from its root, and a search of its file names. */
function Browser({ client, computerId, sessionId, word, onOpen }: { client: FilesClient; computerId: string; sessionId: string; word: (error: unknown) => string; onOpen: (path: string) => void }) {
  const t = useTranslations('team.dsh.browse');
  const [path, setPath] = useState('');
  const [folder, setFolder] = useState<FolderListing | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; matches: string[]; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFolder(null);
    setFailed(null);
    client.listFiles(computerId, sessionId, path).then((read) => { if (live) setFolder(read); }, (error) => { if (live) setFailed(word(error)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, path]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) return setFound(null);
    let live = true;
    // Typing settles before the computer walks its folders.
    const timer = setTimeout(() => {
      client.searchFiles(computerId, sessionId, needle).then((read) => { if (live) setFound({ query: needle, ...read }); }, (error) => { if (live) setFailed(word(error)); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, query]);

  const parts = path ? path.split('/') : [];
  const join = (name: string) => (path ? `${path}/${name}` : name);
  return (
    <div className="flex flex-col gap-2">
      <label className="relative mx-1 block">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} className="h-9 pl-8" />
      </label>
      {failed && <p role="alert" className="px-2.5 text-sm text-destructive">{failed}</p>}
      {query.trim() ? (
        !found || found.query !== query.trim() ? (
          <Loader className="m-3 size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : found.matches.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('noMatches')}</p>
        ) : (
          <>
            {found.matches.map((match) => (
              <button key={match} type="button" className={item} title={match} onClick={() => onOpen(match)}>
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-xs">{match}</span>
              </button>
            ))}
            {found.truncated && <p className="px-2.5 text-xs text-muted-foreground">{t('moreMatches')}</p>}
          </>
        )
      ) : (
        <>
          <nav aria-label={t('path')} className="flex flex-wrap items-center gap-1 px-2.5 text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" onClick={() => setPath('')}>{t('root')}</button>
            {parts.map((part, index) => (
              <span key={index} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <button type="button" className="hover:text-foreground" onClick={() => setPath(parts.slice(0, index + 1).join('/'))}>{part}</button>
              </span>
            ))}
          </nav>
          {!folder && !failed && <Loader className="m-3 size-4 animate-spin text-muted-foreground" aria-hidden />}
          {folder?.entries.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('empty')}</p>}
          {folder?.entries.map((entry) => (
            <button key={entry.name} type="button" className={item} onClick={() => (entry.kind === 'directory' ? setPath(join(entry.name)) : onOpen(join(entry.name)))}>
              {entry.kind === 'directory'
                ? <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.bytes !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{fileSize(entry.bytes)}</span>}
            </button>
          ))}
          {folder?.truncated && <p className="px-2.5 text-xs text-muted-foreground">{t('moreEntries')}</p>}
        </>
      )}
    </div>
  );
}

/** One text file, read only, with its line numbers; `line`, when given, is scrolled to and marked. */
function Viewer({ client, computerId, sessionId, path, line, word, onBack }: { client: FilesClient; computerId: string; sessionId: string; path: string; line?: number; word: (error: unknown) => string; onBack: () => void }) {
  const t = useTranslations('team.dsh.browse');
  const [file, setFile] = useState<Text | null>(null);
  const [document, setDocument] = useState<Uint8Array | null>(null);
  const previewKind = documentPreviewKind(path);
  const [failed, setFailed] = useState<string | null>(null);
  const marked = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'center' });
  }, [file]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const fail = (error: unknown) => { if (live) setFailed(word(error)); };
    if (previewKind) {
      void client.readDocument(computerId, sessionId, path, controller.signal).then((bytes) => { if (live) setDocument(bytes); }, fail);
    } else {
      void client.readFile(computerId, sessionId, path).then((read) => { if (live) setFile(read); }, fail);
    }
    return () => { live = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, sessionId, path, previewKind]);
  const lines = file ? file.text.replace(/\n$/, '').split('\n') : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t('back')}
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file?.path ?? path}>{file?.path ?? path}</span>
        {file && <span className="shrink-0 text-xs text-muted-foreground">{fileSize(file.bytes)}</span>}
      </div>
      {failed && <p role="alert" className="p-4 text-sm text-destructive">{failed}</p>}
      {!file && !document && !failed && <Loader className="m-4 size-4 animate-spin text-muted-foreground" aria-hidden />}
      {document && <Suspense fallback={<Loader className="m-4 size-4 animate-spin" />}><SessionDocumentPreview data={document} workbook={previewKind === 'workbook'} /></Suspense>}
      {file && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full font-mono text-xs leading-5">
            <tbody>
              {lines.map((content, index) => (
                <tr key={index} ref={index + 1 === line ? marked : undefined} className={cn(index + 1 === line && 'bg-signal/15')}>
                  <td className="select-none border-r px-3 text-right align-top text-muted-foreground tabular-nums">{index + 1}</td>
                  <td className="w-full px-3 whitespace-pre">{content}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {file.truncated && <p className="border-t p-3 text-xs text-muted-foreground">{t('truncated')}</p>}
        </div>
      )}
    </div>
  );
}
