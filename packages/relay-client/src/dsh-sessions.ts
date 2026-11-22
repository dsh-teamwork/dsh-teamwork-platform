/**
 * A computer's sessions over any link to its DSH: what the screens ask of a computer (list, follow, start, prompt,
 * answer, configure, upload), spoken as DSH's Remote API and the teamwork plugin's bridge calls
 * (docs/tech/relay.md, "The allow-list"). The relay's encrypted channel is one link (`live.ts`); an edition may
 * bring another, a server that reaches a computer itself, and the same screens then read it.
 *
 * - A unary call answers with its value, or rejects with a `RelayError`.
 * - A stream (`session/follow`, `$events`) delivers DSH's own mux frames (`item`, `error`, `end`) until it ends or is
 *   closed.
 * - The link says when a computer's streams ended (`ended`), so its follows close and, for a reason that passes,
 *   open again.
 *
 * What DSH sends is read in `dsh.ts`; this module only holds the state the screens follow.
 */

import { unbase64 } from './secure-channel';
import { z } from 'zod';
import { UploadLimitsSchema } from './uploads';
import { configurationOf, defaultDirectory, ModelSelectionSchema, startableDirectories } from './session-config';
import {
  approvalResult,
  directoryName,
  eventsOf,
  historyOf,
  newStreams,
  pendingOf,
  questionsResult,
  sessionsOf,
  snapshotOf,
  streamEventsOf,
  waitingOf,
  type Streams,
  type Waiting,
} from './dsh';
import { applySessionEvent } from './session';
import { RelayError, type Answer, type Pending, type RelayClient, type RelayErrorCode, type SessionEvent, type SessionState } from './types';

/** How a computer's DSH is reached: the relay's channel, or an edition's server. */
export interface DshLink {
  /** One unary call; resolves with DSH's value, rejects with a `RelayError`. */
  call(computerId: string, method: string, args: unknown): Promise<unknown>;
  /** Opens a stream and resolves with its id; each of its mux frames goes to `onBody`, which may be called before this resolves. */
  open(computerId: string, endpoint: string, args: unknown, onBody: (body: Record<string, unknown>) => void): Promise<string>;
  /** Stops delivering a stream; `cancel` also tells the computer, which a stream that already ended does not need. */
  close(computerId: string, streamId: string, cancel: boolean): void;
}

/** What a computer's sessions are, over a link: `RelayClient`'s session half. */
export type DshSessions = Pick<
  RelayClient,
  | 'listSessions'
  | 'watchSessions'
  | 'follow'
  | 'older'
  | 'createSession'
  | 'configuration'
  | 'selectModel'
  | 'selectPermission'
  | 'listFiles'
  | 'searchFiles'
  | 'readFile'
  | 'readDocument'
  | 'uploadCapabilities'
  | 'startUpload'
  | 'uploadChunk'
  | 'finishUpload'
  | 'cancelUpload'
  | 'cancel'
  | 'renameSession'
  | 'pinSession'
  | 'archiveSession'
  | 'prompt'
  | 'answer'
> & {
  /** One computer's streams ended (its channel closed, or it went offline): its follows close, and retry when `reason` passes. */
  ended(computerId: string, reason: RelayErrorCode): void;
  /** Every computer's streams ended (the socket closed); follows retry. */
  endedAll(): void;
  /** Signed out: every follow ends for good, and nothing comes back. */
  reset(): void;
};

/** How long a follow that lost its computer waits before it tries again, doubling to the last. */
export const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Why a follow may end and come back: the socket, the channel or the computer went away for now. */
const RETRIED: ReadonlySet<RelayErrorCode> = new Set(['unavailable', 'offline']);

const FolderSchema = z.object({
  path: z.string(),
  entries: z.object({ name: z.string(), kind: z.enum(['file', 'directory']), bytes: z.number().optional() }).array(),
  truncated: z.boolean(),
});

/** How many messages one read of older history asks for, as many as DSH's own opening window. */
const HISTORY_PAGE = 50;

/** DSH's and the bridge's refusals, in the words the screens already have. */
const DSH_ERRORS: Record<string, RelayErrorCode> = {
  'method_not_allowed': 'configuration_unsupported', configuration_unsupported: 'configuration_unsupported',
  'no_web_server': 'offline', dsh_unreachable: 'offline',
  'session/not-found': 'not_found', 'session/agent-busy': 'busy',
  'session/model-unavailable': 'model_unavailable', 'session/provider-credentials-unavailable': 'model_unavailable',
  'session/provider-models-unavailable': 'model_unavailable', 'agent-preset/not-found': 'preset_unavailable',
  'agent-preset/invalid': 'preset_unavailable', 'agent-preset/locked': 'busy',
  'teamwork/busy': 'busy', 'teamwork/not_found': 'not_found', 'teamwork/not_authenticated': 'not_authenticated',
  'teamwork/missing_tools': 'missing_tools', 'teamwork/missing_plugins': 'missing_plugins',
  'teamwork/image_model_unsupported': 'image_model_unsupported',
  'teamwork/file_type': 'file_type', 'teamwork/file_name': 'file_name', 'teamwork/file_too_large': 'file_too_large', 'teamwork/invalid_upload': 'invalid_upload',
  'teamwork/upload_expired': 'upload_expired', 'teamwork/upload_failed': 'upload_failed', 'session/attachment-invalid': 'upload_expired',
  'teamwork/locked': 'locked', 'teamwork/preset_changed': 'preset_changed', 'teamwork/model_unavailable': 'model_unavailable', 'teamwork/invalid_request': 'invalid_request',
  'teamwork/document_too_large': 'document_too_large', 'teamwork/preview_unavailable': 'preview_unavailable',
  'teamwork/permission_refused': 'permission_refused', 'teamwork/not_text': 'not_text', 'session/title-invalid': 'invalid_request', 'workspace/session-active': 'busy', 'workspace/not-found': 'not_found',
  // A cloud computer's server: an answer to a question no page of that computer still holds.
  'teamwork/stale': 'stale',
};

/**
 * A bridge call's answer (`{ status, body }`, the relay's `result` or a server's) as its value, or the `RelayError` its
 * refusal means.
 */
export function bridgeValue(status: number, body: unknown): unknown {
  const wire = body as { error?: string; result?: { ok?: boolean; value?: unknown; error?: { code?: string } } } | null;
  const result = wire?.result;
  if (status === 200 && result?.ok) return result.value;
  throw new RelayError(DSH_ERRORS[result?.error?.code ?? wire?.error ?? ''] ?? 'unavailable');
}

interface Follow {
  computerId: string;
  sessionId: string;
  /** Its stream on the computer, or empty while it is (re)opening or waits to retry. */
  streamId: string;
  state: SessionState;
  streams: Streams;
  opening?: object;
  emit: (event: SessionEvent) => void;
}

interface Events {
  streamId: string;
  /** Resolves once DSH has said the stream is ready, after which it replays what already waits. */
  ready: Promise<void>;
  clientId?: string;
  waiting: Map<string, Waiting>;
  /** Answers so far to a batch of questions, by event id. */
  answered: Map<string, string[]>;
}

export function createDshSessions(link: DshLink, options: { locale: () => string; nextId: () => string }): DshSessions {
  const { call } = link;
  const follows = new Set<Follow>();
  const events = new Map<string, Events>();
  /** Lists watching a computer's sessions, by computer id. */
  const listWatchers = new Map<string, Set<() => void>>();
  const sessionsChanged = (computerId: string) => listWatchers.get(computerId)?.forEach((onChange) => onChange());

  /**
   * Follows that lost their computer for now try again, all together, after a wait that doubles while they keep
   * failing. Each says it is closed meanwhile; its fresh snapshot, once it opens again, clears that.
   */
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  function retryLater() {
    if (retryTimer || ![...follows].some((follow) => !follow.streamId)) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retries++;
      for (const follow of follows) if (!follow.streamId) void open(follow);
    }, RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]);
  }
  /** A follow's stream ended: for good unless `reason` is one that passes. */
  function interrupted(follow: Follow, reason: RelayErrorCode) {
    if (follow.streamId && follow.streamId !== 'opening') link.close(follow.computerId, follow.streamId, false);
    follow.streamId = '';
    follow.opening = undefined;
    follow.emit({ type: 'closed', reason });
    if (RETRIED.has(reason)) return retryLater();
    follows.delete(follow);
  }

  /** Opens a follow's stream: its snapshot, then every change. A failure ends it, or retries it (`interrupted`). */
  async function open(follow: Follow) {
    const { computerId, sessionId } = follow;
    const opening = {};
    follow.opening = opening;
    follow.streamId = 'opening';
    try {
      await watchEvents(computerId);
      if (!follows.has(follow) || follow.opening !== opening) return;
      const streamId = await link.open(computerId, 'session/follow', { request: { address: { kind: 'session', sessionId }, activate: true, assistantStream: true } }, (body) => {
        // Frames can come before `open` returns, while the follow still says it is opening.
        if (!follows.has(follow) || follow.opening !== opening) return;
        if (body.type === 'end') return interrupted(follow, 'unavailable');
        if (body.type === 'error') {
          const code = (body.error as { code?: unknown } | undefined)?.code;
          // DSH or its web server went away, and may come back; anything else is this session's own end.
          return interrupted(follow, code === 'dsh_closed' || code === 'dsh_unreachable' || code === 'no_web_server' ? 'unavailable' : 'not_found');
        }
        if (body.type !== 'item') return;
        const value = body.value as Record<string, unknown> | undefined;
        if (value?.type === 'snapshot') {
          retries = 0;
          follow.state = { ...snapshotOf(value, follow.streams), pending: pendingFor(computerId, sessionId) };
          return follow.emit({ type: 'snapshot', state: follow.state });
        }
        const changes =
          value?.type === 'event'
            ? eventsOf(value.event, follow.state)
            : value?.type === 'assistant-stream'
              ? streamEventsOf(value.frame, follow.streams)
              : [];
        for (const change of changes) {
          follow.state = applySessionEvent(follow.state, change);
          follow.emit(change);
        }
      });
      if (follows.has(follow) && follow.opening === opening) follow.streamId = streamId;
      // Stopped, or interrupted, while it opened.
      else link.close(computerId, streamId, true);
    } catch (error) {
      if (!follows.has(follow) || follow.opening !== opening) return;
      follow.streamId = '';
      interrupted(follow, error instanceof RelayError ? error.code : 'unavailable');
    }
  }

  /** What a session's follower should show as waiting: the oldest request for it, or nothing. */
  function pendingFor(computerId: string, sessionId: string) {
    const known = events.get(computerId);
    for (const waiting of known?.waiting.values() ?? []) {
      if (waiting.agentId === sessionId) return pendingOf(waiting, known!.answered.get(waiting.eventId)?.length ?? 0);
    }
    return null;
  }

  function tellFollowers(computerId: string, sessionId: string, event: SessionEvent) {
    for (const follow of follows) {
      if (follow.computerId !== computerId || follow.sessionId !== sessionId) continue;
      follow.state = applySessionEvent(follow.state, event);
      follow.emit(event);
    }
  }

  /** One `$events` stream per computer, opened by its first follower and kept while its link lives. */
  async function watchEvents(computerId: string) {
    if (events.has(computerId)) return;
    let isReady = () => {};
    const watched: Events = { streamId: '', ready: new Promise((resolve) => (isReady = resolve)), waiting: new Map(), answered: new Map() };
    events.set(computerId, watched);
    // A stream that never opened is not kept: the next follow or list opens one again.
    const opened = link.open(computerId, '$events', {}, (body) => {
      if (events.get(computerId) !== watched) return;
      // The stream ended on its own: the next follow or list opens it again.
      if (body.type === 'error' || body.type === 'end') {
        events.delete(computerId);
        return;
      }
      if (body.type !== 'item') return;
      const value = body.value as Record<string, unknown> | undefined;
      if (!value) return;
      if (value.type === 'ready' && typeof value.clientId === 'string') {
        watched.clientId = value.clientId;
        isReady();
      } else if (value.type === 'emit' && value.event === 'api-session/status' && Array.isArray(value.args)) {
        const [sessionId, running] = value.args as [unknown, unknown];
        if (typeof sessionId === 'string') tellFollowers(computerId, sessionId, { type: 'status', status: running === true ? 'running' : 'idle' });
        sessionsChanged(computerId);
      } else if (value.type === 'waterfall') {
        const waiting = waitingOf(value, options.locale());
        if (!waiting) return;
        watched.waiting.set(waiting.eventId, waiting);
        tellFollowers(computerId, waiting.agentId, { type: 'pending', pending: pendingFor(computerId, waiting.agentId) });
        sessionsChanged(computerId);
      } else if (value.type === 'cancel' && typeof value.eventId === 'string') {
        const waiting = watched.waiting.get(value.eventId);
        if (!waiting) return;
        watched.waiting.delete(value.eventId);
        watched.answered.delete(value.eventId);
        tellFollowers(computerId, waiting.agentId, { type: 'pending', pending: pendingFor(computerId, waiting.agentId) });
        sessionsChanged(computerId);
      }
    });
    try {
      watched.streamId = await opened;
    } catch (error) {
      if (events.get(computerId) === watched) events.delete(computerId);
      throw error;
    }
  }

  return {
    ended(computerId, reason) {
      const gone = events.get(computerId);
      if (gone?.streamId) link.close(computerId, gone.streamId, false);
      events.delete(computerId);
      for (const follow of [...follows]) if (follow.computerId === computerId && follow.streamId) interrupted(follow, reason);
    },

    endedAll() {
      events.clear();
      for (const follow of [...follows]) interrupted(follow, 'unavailable');
    },

    reset() {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      retries = 0;
      for (const follow of [...follows]) interrupted(follow, 'not_found');
      events.clear();
      listWatchers.clear();
    },

    async listSessions(computerId) {
      // Knowing which sessions wait on the member needs the computer's $events: DSH replays what waits once it is ready.
      await watchEvents(computerId);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([events.get(computerId)?.ready, new Promise((resolve) => { timeout = setTimeout(resolve, 2_000); })]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      const pending = new Map<string, Pending>();
      for (const { agentId } of events.get(computerId)?.waiting.values() ?? []) {
        const next = pendingFor(computerId, agentId);
        if (next && !pending.has(agentId)) pending.set(agentId, next);
      }
      return sessionsOf(await call(computerId, 'session/list', { _request: {} }), pending);
    },

    watchSessions(computerId, onChange) {
      let watchers = listWatchers.get(computerId);
      if (!watchers) listWatchers.set(computerId, (watchers = new Set()));
      watchers.add(onChange);
      return () => void watchers.delete(onChange);
    },

    follow(computerId, sessionId, onEvent) {
      const follow: Follow = {
        computerId,
        sessionId,
        streamId: '',
        state: { status: 'idle', items: [], pending: null, closed: null, earlier: null },
        streams: newStreams(),
        emit: onEvent,
      };
      follows.add(follow);
      void open(follow);
      return () => {
        follows.delete(follow);
        const streamId = follow.streamId;
        if (!streamId || streamId === 'opening') return;
        link.close(computerId, streamId, true);
      };
    },

    async older(computerId, sessionId) {
      const followed = [...follows].find((f) => f.computerId === computerId && f.sessionId === sessionId);
      const before = followed?.state.earlier;
      if (before == null) return;
      const page = historyOf(await call(computerId, 'session/page', { request: { address: { kind: 'session', sessionId }, beforeSeq: before, maxMessages: HISTORY_PAGE } }));
      // Another read got there first: the items it read stay as they are.
      if (followed!.state.earlier !== before) return;
      tellFollowers(computerId, sessionId, { type: 'older', items: page.items, earlier: page.earlier });
    },

    async createSession(computerId, choice = {}) {
      const sessions = await call(computerId, 'session/list', { _request: {} });
      const offered = (await call(computerId, 'teamwork/configuration', { request: {} }).catch(() => null)) as { directories?: unknown; teamDirectories?: unknown } | null;
      const directories = startableDirectories(sessions, Array.isArray(offered?.directories) ? offered.directories.filter((path): path is string => typeof path === 'string') : []);
      const teams = z.record(z.string(), z.string()).catch({}).parse(offered?.teamDirectories ?? {});
      const cwd = choice.cwd ?? defaultDirectory(directories, teams, choice.teamId);
      if (!cwd) throw new RelayError('no_directory');
      if (!directories.some(directory => directory.path === cwd)) throw new RelayError('invalid_directory');
      const created = (await call(computerId, 'session/create', { request: { cwd, ...(choice.agentPreset ? { agentPreset: choice.agentPreset } : {}) } })) as { sessionId?: unknown } | null;
      if (typeof created?.sessionId !== 'string') throw new RelayError('unavailable');
      return { id: created.sessionId, directory: directoryName(cwd) };
    },

    async configuration(computerId, sessionId) {
      const [sessions, models, configuration] = await Promise.all([
        call(computerId, 'session/list', { _request: {} }), call(computerId, 'session/modelCatalog', {}),
        call(computerId, 'teamwork/configuration', { request: { ...(sessionId ? { sessionId } : {}) } }),
      ]);
      return configurationOf(sessions, models, configuration);
    },

    async listFiles(computerId, sessionId, path) {
      return FolderSchema.parse(await call(computerId, 'teamwork/listFiles', { request: { sessionId, path } }));
    },

    async searchFiles(computerId, sessionId, query) {
      return z.object({ matches: z.string().array(), truncated: z.boolean() }).parse(await call(computerId, 'teamwork/searchFiles', { request: { sessionId, query } }));
    },

    async readDocument(computerId, sessionId, path, signal) {
      const chunkSize = 128 * 1024;
      const schema = z.object({ version: z.string().min(1).max(128), size: z.number().int().positive().max(16 * 1024 * 1024),
        offset: z.number().int().nonnegative(), data: z.string().min(1).max(Math.ceil(chunkSize / 3) * 4) });
      let result: Uint8Array | undefined;
      let version: string | undefined;
      let offset = 0;
      do {
        signal?.throwIfAborted();
        const response = schema.safeParse(await call(computerId, 'teamwork/readDocument', {
          request: { sessionId, path, offset, ...(version ? { version } : {}) },
        }));
        signal?.throwIfAborted();
        if (!response.success) throw new RelayError('unavailable');
        const chunk = response.data;
        result ??= new Uint8Array(chunk.size);
        version ??= chunk.version;
        if (chunk.offset !== offset || chunk.version !== version || chunk.size !== result.length) throw new RelayError('unavailable');
        let data: Uint8Array;
        try { data = unbase64(chunk.data); } catch { throw new RelayError('unavailable'); }
        if (data.length !== Math.min(chunkSize, result.length - offset)) throw new RelayError('unavailable');
        result.set(data, offset);
        offset += data.length;
      } while (offset < result.length);
      return result;
    },
    async readFile(computerId, sessionId, path) {
      return z.object({ path: z.string(), text: z.string(), bytes: z.number(), truncated: z.boolean() }).parse(await call(computerId, 'teamwork/readFile', { request: { sessionId, path } }));
    },

    async selectPermission(computerId, sessionId, preset) {
      return z.object({ current: z.string() }).parse(await call(computerId, 'teamwork/selectPermission', { request: { sessionId, preset } })).current;
    },

    async selectModel(computerId, sessionId, selection) {
      return z.object({ selected: ModelSelectionSchema }).parse(await call(computerId, 'teamwork/selectModel', { request: { sessionId, ...selection } })).selected;
    },

    async uploadCapabilities(computerId) {
      return (
        z
          .object({ uploads: UploadLimitsSchema.nullish() })
          .parse(await call(computerId, 'teamwork/configuration', { request: {} })).uploads ?? null
      );
    },
    async startUpload(computerId, sessionId, name, bytes) {
      return z
        .object({
          uploadId: z.string(),
          chunkBytes: z
            .number()
            .int()
            .positive()
            .max(256 * 1024),
        })
        .parse(await call(computerId, 'teamwork/uploadStart', { request: { sessionId, name, bytes } }));
    },
    async uploadChunk(computerId, sessionId, uploadId, offset, data) {
      return z
        .object({ received: z.number().int().nonnegative() })
        .parse(await call(computerId, 'teamwork/uploadChunk', { request: { sessionId, uploadId, offset, data } }))
        .received;
    },
    async finishUpload(computerId, sessionId, uploadId) {
      return z
        .object({
          receiptId: z.string(),
          file: z.object({ attachmentId: z.string(), name: z.string(), bytes: z.number().int().nonnegative() }),
        })
        .parse(await call(computerId, 'teamwork/uploadFinish', { request: { sessionId, uploadId } }));
    },
    async cancelUpload(computerId, sessionId, uploadId) {
      await call(computerId, 'teamwork/uploadCancel', { request: { sessionId, uploadId } });
    },
    async cancel(computerId, sessionId) {
      await call(computerId, 'session/cancel', { request: { sessionId } });
    },

    // Pins and archives change no session, so nothing of DSH's says so: the lists watching read themselves again.
    async renameSession(computerId, sessionId, title) {
      const renamed = z.object({ title: z.string() }).parse(await call(computerId, 'session/rename', { request: { sessionId, title } }));
      sessionsChanged(computerId);
      return renamed.title;
    },

    async pinSession(computerId, sessionId, pinned) {
      await call(computerId, pinned ? 'workspace/pinSession' : 'workspace/unpinSession', { request: { sessionId } });
      sessionsChanged(computerId);
    },

    async archiveSession(computerId, sessionId, archived) {
      await call(computerId, archived ? 'workspace/archiveSession' : 'workspace/unarchiveSession', { request: { sessionId } });
      sessionsChanged(computerId);
    },

    async prompt(computerId, sessionId, text, attachments) {
      await call(computerId, 'session/prompt', {
        request: {
          requestId: attachments?.requestId ?? options.nextId(),
          sessionId,
          mode: 'queue',
          content: [
            ...(text.trim() ? [{ type: 'text', text }] : []),
            ...(attachments?.receipts ?? []).map((receiptId) => ({ type: 'file', receiptId })),
          ],
        },
      });
    },

    async answer(computerId, sessionId, pendingId, answer: Answer) {
      const watched = events.get(computerId);
      const eventId = pendingId.split('#')[0]!;
      const waiting = watched?.waiting.get(eventId);
      if (!watched?.clientId || !waiting) throw new RelayError('stale');
      let value: unknown;
      if (waiting.kind === 'questions' && answer.kind === 'question') {
        const selected = [...(watched.answered.get(eventId) ?? []), answer.optionId];
        if (selected.length < waiting.questions.length) {
          watched.answered.set(eventId, selected);
          // The list shows the next question of the batch too.
          sessionsChanged(computerId);
          return tellFollowers(computerId, sessionId, { type: 'pending', pending: pendingFor(computerId, sessionId) });
        }
        value = questionsResult(waiting, selected);
      } else if (waiting.kind === 'approval' && answer.kind === 'approval') {
        value = approvalResult(answer.approve);
      } else {
        throw new RelayError('stale');
      }
      await call(computerId, '$events/result', { clientId: watched.clientId, eventId, outcome: { kind: 'result', value } });
      watched.waiting.delete(eventId);
      watched.answered.delete(eventId);
      sessionsChanged(computerId);
      tellFollowers(computerId, sessionId, { type: 'pending', pending: pendingFor(computerId, sessionId) });
    },
  };
}
