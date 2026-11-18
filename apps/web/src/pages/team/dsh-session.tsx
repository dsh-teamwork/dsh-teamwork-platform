/**
 * What the console's pages for reaching a DSH share (Team DSH, team-dsh.tsx; My DSH, my-dsh.tsx): the three columns
 * beside the sidebar, a computer's sessions and PIN as its DSH reports them through the relay, the conversation, the
 * composer and the PIN gate. Everything here runs over `@/lib/relay`, end to end encrypted to the DSH.
 */

import { ChevronDown, FileText, Loader, MessagesSquare, Paperclip, Plus, Server, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { useFormatter, useTranslations } from 'use-intl';

import {
  applySessionEvent,
  defaultDirectory,
  deliverFiles,
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
  pinPrompt,
  RelayError,
  rowsOf,
  type ModelSelection,
  type PinState,
  type RelayErrorCode,
  type SessionConfiguration,
  type SessionOptions,
  type SessionState,
  type SessionSummary,
} from '@dsh-teamwork/relay-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { relayFor } from '@/lib/relay';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

const WORDED = new Set(['file_type', 'file_name', 'file_too_large', 'invalid_upload', 'upload_expired', 'upload_failed', 'upload_cancelled', 'upload_unsupported', 'send_uncertain', 'offline', 'not_found', 'busy', 'stale', 'locked', 'invite_refused', 'device_key_changed', 'device_verification_required', 'no_directory', 'not_authenticated', 'missing_tools', 'missing_plugins', 'preset_unavailable', 'model_unavailable']);

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
 * The page's three columns beside the sidebar: its title and `list` in the second, `children` in the third. On a phone
 * the list folds under a button that names it, unlike the console's own menu in the bar above; `onPick` folds it again.
 */
export function DshColumns({ title, list, children }: { title: string; list: (onPick: () => void) => ReactNode; children: ReactNode }) {
  const t = useTranslations('team.dsh');
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-72 md:shrink-0 md:border-r md:border-b-0 md:px-3">
        <div className="flex items-center gap-2.5 md:px-1">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
          <Button type="button" variant="outline" size="sm" className="md:hidden" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MessagesSquare className="size-4" aria-hidden />
            {t('sessions')}
            <ChevronDown className={cn('size-4 transition-transform', menu && 'rotate-180')} aria-hidden />
          </Button>
        </div>
        <nav aria-label={title} className={cn(menu ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-sm md:flex')}>
          {list(() => setMenu(false))}
        </nav>
      </aside>
      <section className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-6 px-4 pt-6 md:px-8 md:pt-8">{children}</section>
    </div>
  );
}

/**
 * One computer's sessions and PIN lock as its DSH reports them, followed while `computerId` is open (a pairing id;
 * none is "", and then nothing is read). `locked` is whether the PIN gate stands before everything else.
 */
export function useComputer(computerId: string) {
  const { me } = useTeam();
  const word = useRelayError();
  const relay = relayFor(me);
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

/** Beneath the open computer in the column: a new session, then the member's sessions on it, or a word that it is locked. */
export function SessionList({ base, locked, sessions, sessionId, onPick }: { base: string; locked: boolean; sessions: SessionSummary[] | null; sessionId: string; onPick: () => void }) {
  const t = useTranslations('team.dsh');
  const format = useFormatter();
  return (
    <div className="ml-4 flex flex-col gap-0.5 border-l pl-2">
      {locked ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('locked')}</p>
      ) : (
        <>
          <Link to={base} onClick={onPick} className={cn(row, 'gap-2 text-muted-foreground')}>
            <Plus className="size-4" aria-hidden />
            {t('newSession')}
          </Link>
          {sessions?.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('noSessions')}</p>}
          {sessions?.map((s) => (
            <Link
              key={s.id}
              to={`${base}/${s.id}`}
              onClick={onPick}
              aria-current={s.id === sessionId ? 'page' : undefined}
              className={cn(row, 'flex-col items-stretch gap-0.5', s.id === sessionId && cn(selected, 'font-medium'))}
            >
              <span className="flex items-center gap-2">
                {s.pending && <Dot className="bg-signal" label={t('waiting')} />}
                <span className="truncate">{s.title || t('untitled')}</span>
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {s.status === 'running' ? t('running') : format.relativeTime(new Date(s.updatedAt), new Date())} · {s.directory}
              </span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

/** A computer's row in the column: its name, a word under it, and a navy dot while it is online. */
export function ComputerRow({ icon: Icon = Server, name, note, online, to, open, current, onPick }: { icon?: LucideIcon; name: string; note: string; online?: boolean; to?: string; open?: boolean; current?: boolean; onPick?: () => void }) {
  const inner = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        <span className="truncate text-xs font-normal text-muted-foreground">{note}</span>
      </span>
      {online !== undefined && <Dot className={online ? 'bg-brand' : 'bg-muted-foreground/40'} />}
    </>
  );
  return to ? (
    <Link to={to} onClick={onPick} className={cn(row, 'gap-2.5', current && selected, open && 'font-medium')}>{inner}</Link>
  ) : (
    <div className={cn(row, 'gap-2.5 text-muted-foreground hover:bg-transparent')}>{inner}</div>
  );
}

/** A new session looks like one with nothing in it yet: sending the first message starts it, then opens it. */
export function NewSession({ computerId, name, started }: { computerId: string; name: string; started: (sessionId: string) => void }) {
  const { me, team } = useTeam();
  const t = useTranslations('team.dsh');
  const word = useRelayError();
  const relay = relayFor(me);
  const [sent, setSent] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [options, setOptions] = useState<SessionOptions>({});
  const files = useFiles(computerId);

  async function start(text: string) {
    setSent(text || files.files.map((file) => file.name).join(', '));
    setFailed(null);
    try {
      // Files need their session before their bytes move; a retry after a failed upload reuses it.
      const created = files.files.length
        ? await files.target({ cwd: options.cwd, agentPreset: options.agentPreset, teamId: team.id })
        : await relay.createSession(computerId, { cwd: options.cwd, agentPreset: options.agentPreset, teamId: team.id });
      if (options.model) await relay.selectModel(computerId, created.id, options.model);
      if (files.files.length) await files.send(created.id, text);
      else await relay.prompt(computerId, created.id, text);
      started(created.id);
      return true;
    } catch (error) {
      setFailed(word(error));
      setSent('');
      return false;
    }
  }

  return (
    <>
      {sent ? (
        <ol className="flex flex-col gap-4 text-sm">
          <li className="ml-auto max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{sent}</li>
          <li role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden />
            {t('thinking')}
          </li>
        </ol>
      ) : (
        <section className="m-auto flex max-w-lg flex-col items-center gap-3 py-10 text-center">
          <Server className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t('newTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('newHint', { name })}</p>
        </section>
      )}
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      <Composer busy={sent !== ''} placeholder={t('firstPlaceholder')} send={start} files={files}>
        <SessionSettings computerId={computerId} disabled={sent !== ''} value={options} onChange={(next) => {
          // Another folder or preset is another session: files sent to the old one are sent again.
          if (next.cwd !== options.cwd || next.agentPreset !== options.agentPreset) files.retarget();
          setOptions(next);
        }} />
      </Composer>
    </>
  );
}

/** The message box at a conversation's foot: Enter sends, Shift+Enter breaks the line; `send` says whether to clear it. */
const modelKey = (model: ModelSelection | null | undefined) => (model ? JSON.stringify([model.provider, model.model]) : '');

/**
 * The workspace, preset and model a session runs with, as its computer reports them (`configuration`), beside the
 * composer. A new session's are chosen before its first message (`value`, given back through `onChange`); an existing
 * session shows its folder and preset, which stay as they are, and changes its model while it is idle, for that session
 * alone (`teamwork/selectModel`); whether it is idle is the conversation's, which follows it, not the read's. A computer whose plugin reports none shows nothing, and its defaults hold.
 */
function SessionSettings({ computerId, sessionId, disabled, value = {}, onChange }: {
  computerId: string;
  sessionId?: string;
  disabled: boolean;
  value?: SessionOptions;
  onChange?: (value: SessionOptions) => void;
}) {
  const { me, team } = useTeam();
  const t = useTranslations('team.dsh.settings');
  const word = useRelayError();
  const relay = relayFor(me);
  const [data, setData] = useState<SessionConfiguration | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    relay.configuration(computerId, sessionId).then(
      (read) => { if (live) setData(read); },
      // An older plugin, or a computer that went away: the defaults hold, as before there were choices.
      () => {},
    );
    return () => { live = false; };
  }, [relay, computerId, sessionId]);

  if (!data) return null;
  const current = sessionId ? data.current : null;
  const models = [
    ...(sessionId ? [] : [{ value: '', label: t('followPreset') }]),
    ...data.models.map((model) => ({ value: modelKey({ provider: model.provider, model: model.id }), label: `${model.name} · ${model.providerName}` })),
  ];
  const chosenModel = sessionId ? current?.model : value.model;
  // How hard the chosen model reasons, where it says it can be told: its own default, or one of its efforts.
  const reasoning = data.models.find((model) => model.provider === chosenModel?.provider && model.id === chosenModel?.model)?.reasoning;
  const efforts = reasoning ? [{ value: '', label: t('effortDefault') }, ...reasoning.efforts.map((effort) => ({ value: effort.id, label: effort.name }))] : [];
  const withEffort = (effort: string): ModelSelection => ({ provider: chosenModel!.provider, model: chosenModel!.model, ...(effort ? { reasoningEffort: effort } : {}) });
  const toModel = (key: string): ModelSelection | undefined => {
    if (!key) return undefined;
    const [provider, model] = JSON.parse(key) as [string, string];
    return { provider, model };
  };

  async function changeModel(next: ModelSelection) {
    setSaving(true);
    setFailed(null);
    try {
      const selected = await relay.selectModel(computerId, sessionId!, next);
      setData((read) => (read?.current ? { ...read, current: { ...read.current, model: selected } } : read));
    } catch (error) {
      setFailed(word(error));
    } finally {
      setSaving(false);
    }
  }

  if (sessionId) {
    if (!current) return null;
    const preset = data.presets.find((item) => item.id === current.agentPreset);
    return (
      <>
        <span className="truncate text-xs text-muted-foreground" title={current.cwd}>
          {[directoryName(current.cwd) || current.cwd, preset?.name ?? current.agentPreset ?? t('noPreset')].join(' · ')}
        </span>
        <Select label={t('model')} value={modelKey(current.model)} options={models} disabled={disabled || saving}
          change={(key) => { const next = toModel(key); if (next) void changeModel(next); }} className="h-8 max-w-56 text-xs" />
        {reasoning && (
          <Select label={t('effort')} value={current.model?.reasoningEffort ?? ''} options={efforts} disabled={disabled || saving}
            change={(effort) => void changeModel(withEffort(effort))} className="h-8 max-w-40 text-xs" />
        )}
        {failed && <span role="alert" className="text-xs text-destructive">{failed}</span>}
      </>
    );
  }

  const presets = [
    { value: '', label: [t('desktopDefault'), data.presets.find((item) => item.isDefault)?.name].filter(Boolean).join(' · ') },
    // A preset its computer cannot run yet (a missing tool or plugin) is shown, with why, and cannot be chosen.
    ...data.presets.map((item) => ({
      value: item.id,
      label: [item.name, item.teamName, item.blocked && word(new RelayError(item.blocked as RelayErrorCode))].filter(Boolean).join(' · '),
      disabled: !!item.blocked,
    })),
  ];
  // A new session opens in this team's default workspace on the computer unless another folder is picked.
  const cwd = value.cwd ?? defaultDirectory(data.directories, data.teamDirectories, team.id) ?? '';
  return (
    <>
      {data.directories.length > 0 && (
        <Select label={t('workspace')} value={cwd} disabled={disabled} className="h-8 max-w-48 text-xs"
          options={data.directories.map((item) => ({ value: item.path, label: item.name }))}
          change={(path) => onChange?.({ ...value, cwd: path })} />
      )}
      <Select label={t('preset')} value={value.agentPreset ?? ''} options={presets} disabled={disabled} className="h-8 max-w-48 text-xs"
        change={(id) => onChange?.({ ...value, agentPreset: id || undefined, model: undefined })} />
      <Select label={t('model')} value={modelKey(chosenModel)} options={models} disabled={disabled} className="h-8 max-w-56 text-xs"
        change={(key) => onChange?.({ ...value, model: toModel(key) })} />
      {reasoning && (
        <Select label={t('effort')} value={value.model?.reasoningEffort ?? ''} options={efforts} disabled={disabled} className="h-8 max-w-40 text-xs"
          change={(effort) => onChange?.({ ...value, model: withEffort(effort) })} />
      )}
    </>
  );
}

type Files = ReturnType<typeof useFiles>;

/**
 * A message's files in this browser (docs/tech/relay.md, "File attachments"): chosen with the browser's picker and
 * kept as the page's own `File`s, checked against the computer's limits, and sent at Send: their bytes in
 * acknowledged chunks, then one prompt with their receipts (`attachments` of the relay client, which the phone app
 * uses too). A computer whose plugin cannot take files offers none.
 */
function useFiles(computerId: string) {
  const { me } = useTeam();
  const t = useTranslations('team.dsh.files');
  const word = useRelayError();
  const relay = relayFor(me);
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
  function add(list: FileList | null) {
    if (!list?.length || !limits) return;
    const picked = [...list].map((file) => {
      const id = crypto.randomUUID();
      blobs.current.set(id, file);
      return { id, name: file.name, bytes: file.size, uri: id };
    });
    setFailed(null);
    try {
      validateFiles([...files, ...picked], limits);
      choose([...files, ...picked]);
    } catch (error) {
      for (const file of picked) blobs.current.delete(file.id);
      setFailed(word(error));
    }
  }
  function remove(id: string) {
    blobs.current.delete(id);
    draft.current.uploaded.delete(id);
    choose(files.filter((file) => file.id !== id));
  }

  return {
    files, limits, progress, failed, add, remove,
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
          read: async (file, offset, length) => {
            const blob = blobs.current.get(file.uri);
            if (!blob) throw new RelayError('upload_expired');
            return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
          },
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
        onChange={(event) => { files.add(event.target.files); event.target.value = ''; }} />
      <Button type="button" variant="ghost" size="sm" aria-label={t('add')} title={t('add')} disabled={disabled || files.progress !== null} onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden />
      </Button>
    </>
  );
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
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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

function Composer({ busy, placeholder, send, files, children }: { busy: boolean; placeholder: string; send: (text: string) => Promise<boolean>; files: Files; children?: ReactNode }) {
  const t = useTranslations('team.dsh');
  const [text, setText] = useState('');
  // A message may be files alone.
  const can = !busy && files.progress === null && (text.trim() !== '' || files.files.length > 0);
  const submit = async () => {
    if (can && (await send(text.trim()))) setText('');
  };
  return (
    <form
      className="sticky bottom-0 mt-auto bg-background pt-2 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <FileCards files={files} disabled={busy} />
        <Textarea
          value={text}
          rows={2}
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
        <div className="flex flex-wrap items-center gap-2">
          <AttachButton files={files} disabled={busy} />
          {children}
          <Button type="submit" size="sm" className="ml-auto" disabled={!can}>{t('send')}</Button>
        </div>
      </div>
    </form>
  );
}

/** One session: its conversation, what it waits on the member for, and the composer at its foot. */
export function Conversation({ computerId, sessionId, title }: { computerId: string; sessionId: string; title: string }) {
  const { me } = useTeam();
  const t = useTranslations('team.dsh');
  const word = useRelayError();
  const relay = relayFor(me);
  const [state, setState] = useState<SessionState>(EMPTY_SESSION);
  const files = useFiles(computerId);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => relay.follow(computerId, sessionId, (event) => setState((s) => applySessionEvent(s, event))), [relay, computerId, sessionId]);

  const rows = rowsOf(state.items);
  const running = state.status === 'running';
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setFailed(null);
    try {
      await run();
    } catch (error) {
      setFailed(word(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h2>
      <div className="flex flex-col gap-4 text-sm">
        {state.earlier !== null && (
          <Button type="button" variant="ghost" size="sm" className="self-center" disabled={busy} onClick={() => void act(() => relay.older(computerId, sessionId))}>
            {t('earlier')}
          </Button>
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
          ) : row.kind === 'assistant' ? (
            <div key={row.id} className="flex flex-col gap-2 leading-6 [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>{row.text}</Markdown>
            </div>
          ) : (
            <details key={row.id} className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              <summary>{t('steps', { count: row.tools.length })}{row.status === 'running' ? ` · ${t('running')}` : row.status === 'done' ? '' : ` · ${t(row.status)}`}</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {row.tools.map((tool) => <li key={tool.id} className="truncate font-mono">{tool.name} {tool.summary}</li>)}
              </ul>
            </details>
          ),
        )}
        {isThinking(rows, running) && <p className="text-muted-foreground">{t('thinking')}</p>}
        {state.pending?.kind === 'question' && (
          <div className="flex flex-col gap-2 border-l-[3px] border-signal pl-3">
            <p className="font-medium">{state.pending.question}</p>
            <div className="flex flex-wrap gap-2">
              {state.pending.options.map((option) => (
                <Button key={option.id} size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'question', optionId: option.id }))}>
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
              <Button size="sm" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'approval', approve: true }))}>{t('allow')}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'approval', approve: false }))}>{t('deny')}</Button>
            </div>
          </div>
        )}
        {state.closed && <p role="alert" className="text-destructive">{word(new RelayError(state.closed))}</p>}
        {failed && <p role="alert" className="text-destructive">{failed}</p>}
      </div>
      <Composer
        busy={busy || running || !!state.pending}
        placeholder={t('promptPlaceholder')}
        files={files}
        send={async (message) => {
          let sent = false;
          await act(async () => {
            if (files.files.length) await files.send(sessionId, message);
            else await relay.prompt(computerId, sessionId, message);
            sent = true;
          });
          return sent;
        }}
      >
        <SessionSettings computerId={computerId} sessionId={sessionId} disabled={busy || running || !!state.pending} />
        {running && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(() => relay.cancel(computerId, sessionId))}>{t('stop')}</Button>}
      </Composer>
    </>
  );
}

/** The DSH asks for this member's PIN: set a first one, typed twice, or give it. Only the DSH checks it. */
export function PinGate({ computerId, state, lockedHint }: { computerId: string; state: PinState | undefined; lockedHint: string }) {
  const { me } = useTeam();
  const t = useTranslations('team.dsh.pin');
  const relay = relayFor(me);
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
        <CardDescription>{state?.kind === 'wrong' ? t('wrong', { count: state.left }) : prompt === 'locked' ? lockedHint : t(`${prompt}.hint`)}</CardDescription>
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
