/**
 * DSH's Remote API, read into what a session screen draws (`types.ts`). Pure:
 * the live client (`live.ts`) feeds it what the relay carries, the hosted
 * edition's cloud sessions what its server relays from a cloud computer, and
 * the tests frames recorded from a real DSH (`__tests__/fixtures/dsh-session.json`).
 *
 * What is read, and from where (docs/tech/relay.md):
 * - `session/list` → `SessionSummary`: its `items`, minus blank sessions.
 * - `session/follow` → the conversation: a `snapshot` of the log's records, then
 *   one `event` per committed event, and `assistant-stream` frames carrying a
 *   reply's text as it is written. Only what a person said
 *   (`user/message` from `source.kind: 'user'`, or `'schedule'` when one of
 *   their automation tasks delivered it), what the agent said
 *   (`assistant/message` text) and its tool calls become items; the system
 *   prompt, runtime context and bookkeeping events are DSH's own.
 * - `$events` waterfalls → `Pending`: `user-questions/request` and
 *   `approval/request`, answered through `$events/result`.
 */

import { toolKey, visibleReasoning } from './conversation';
import { remindersOf } from './schedule';
import type { ConversationItem, FileTarget, Pending, PublishedPage, SessionChange, SessionState, SessionStatus, SessionSummary, SessionWorkspace, ToolResult } from './types';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (content: unknown, type = 'text') =>
  Array.isArray(content)
    ? content
        .filter((part): part is { type: string; text: string } => isObject(part) && part.type === type && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
    : '';

/** The last part of a path, on either separator: what a person calls the project. */
export function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** One `session/list` item, or null for a blank session nobody has written in yet. */
export function summaryOf(item: unknown): SessionSummary | null {
  if (!isObject(item) || typeof item.sessionId !== 'string' || item.blank === true) return null;
  const values = isObject(item.projections) && isObject(item.projections.values) ? item.projections.values : {};
  const task = isObject(values.teamworkTask) ? values.teamworkTask.task : undefined;
  const step = isObject(values.teamworkStep) ? values.teamworkStep : {};
  const title = typeof values.title === 'string' && values.title ? values.title : typeof task === 'string' ? task : '';
  return {
    id: item.sessionId,
    title,
    status: item.running === true ? 'running' : 'idle',
    updatedAt: new Date(typeof item.updatedAt === 'number' ? item.updatedAt : 0).toISOString(),
    directory: typeof item.cwd === 'string' ? directoryName(item.cwd) : '',
    pending: null,
    marks: isObject(item.teamwork)
      ? { pinned: item.teamwork.pinned === true, archived: item.teamwork.archived === true, workspace: workspaceOf(item.teamwork.workspace) }
      : null,
    // An older plugin reports no step, and an idle session's step is cleared.
    step:
      item.running === true && typeof step.count === 'number' && step.count > 0
        ? { count: step.count, tool: typeof step.tool === 'string' ? step.tool : '', target: typeof step.target === 'string' ? step.target : '' }
        : null,
  };
}

/**
 * `session/list`'s value as the app lists it: no blank sessions; those waiting
 * on the member first, then those pinned, then those running, then the rest,
 * newest change first within each. Archived ones stay in it, marked: a screen
 * hides them until asked.
 */
export function sessionsOf(value: unknown, pending: ReadonlyMap<string, Pending> = new Map()): SessionSummary[] {
  const items = isObject(value) && Array.isArray(value.items) ? value.items : [];
  const rank = (s: SessionSummary) => (s.pending ? 0 : s.marks?.pinned ? 1 : s.status === 'running' ? 2 : 3);
  return items
    .map(summaryOf)
    .filter((s): s is SessionSummary => s !== null)
    .map((s) => ({ ...s, pending: pending.get(s.id) ?? null }))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/** The workspace a `teamwork` mark names, or null: Ungrouped, or a plugin that names none. */
function workspaceOf(value: unknown): SessionWorkspace | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  const index = typeof value.index === 'number' ? value.index : 0;
  const position = typeof value.position === 'number' ? value.position : 0;
  const ancestors = Array.isArray(value.ancestors) ? value.ancestors.flatMap((a: unknown) =>
    isObject(a) && typeof a.id === 'string' && typeof a.title === 'string' && typeof a.index === 'number'
      ? [{ id: a.id, title: a.title, index: a.index }] : []) : [];
  return { id: value.id, title: value.title, index, position, ...(ancestors.length ? { ancestors } : {}) };
}

/** One group of a computer's sessions as DSH's sidebar shows it: a workspace's, or Ungrouped's with `workspace` null. */
export interface SessionGroup {
  workspace: { id: string; title: string } | null;
  sessions: SessionSummary[];
}

/** Pinned sessions first, archived ones never among them, each part in the order it came. */
const pinnedFirst = (sessions: SessionSummary[]) => [
  ...sessions.filter((s) => s.marks?.pinned && !s.marks.archived),
  ...sessions.filter((s) => !(s.marks?.pinned && !s.marks.archived)),
];
const newestFirst = (a: SessionSummary, b: SessionSummary) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : 1);

/**
 * A computer's sessions grouped as DSH's own sidebar groups them (`@deepseek-ai/dsh-client-ui-workspace`): each
 * workspace in DSH's order with its sessions in the workspace's own order, then Ungrouped, newest change first, and
 * within every group the pinned ones lead. Archived sessions are left out unless `archived`; then they stay in their
 * group. A workspace with no session listed here has no group, and a plugin that marks no workspace lists them all
 * under Ungrouped.
 */
export function sessionGroups(sessions: readonly SessionSummary[], archived = false): SessionGroup[] {
  const workspaces = new Map<string, { workspace: SessionWorkspace; sessions: SessionSummary[] }>();
  const ungrouped: SessionSummary[] = [];
  for (const s of sessions) {
    if (s.marks?.archived && !archived) continue;
    const workspace = s.marks?.workspace;
    if (!workspace) {
      ungrouped.push(s);
      continue;
    }
    const group = workspaces.get(workspace.id) ?? { workspace, sessions: [] };
    group.sessions.push(s);
    workspaces.set(workspace.id, group);
  }
  const groups: SessionGroup[] = [...workspaces.values()]
    .sort((a, b) => a.workspace.index - b.workspace.index)
    .map(({ workspace, sessions: members }) => ({
      workspace: { id: workspace.id, title: workspace.title },
      sessions: pinnedFirst(members.sort((a, b) => a.marks!.workspace!.position - b.marks!.workspace!.position)),
    }));
  if (ungrouped.length > 0) groups.push({ workspace: null, sessions: pinnedFirst(ungrouped.sort(newestFirst)) });
  return groups;
}

/**
 * DSH's sidebar search without its matches inside conversations: the sessions whose title or workspace title holds
 * `query`, ignoring case, newest change first, archived ones only with `archived`.
 */
export function searchSessions(sessions: readonly SessionSummary[], query: string, archived = false): SessionSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return sessions
    .filter((s) => archived || !s.marks?.archived)
    .filter((s) => `${s.title}\n${s.marks?.workspace?.title ?? ''}`.toLocaleLowerCase().includes(needle))
    .sort(newestFirst);
}

const TOOL_OUTPUT_LIMIT = 4096;
const REASONING_LIMIT = 16384;
const TOOL_SUMMARY_LIMIT = 1024;

function preview(value: string, limit: number) {
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
}

function toolArgs(args: unknown): Json {
  try {
    const value: unknown = typeof args === 'string' ? JSON.parse(args) : args;
    if (isObject(value)) return value;
  } catch {
    // Older or clipped records can contain incomplete argument JSON.
  }
  return {};
}

function fileTarget(path: unknown, offset?: unknown): FileTarget | undefined {
  if (typeof path !== 'string' || !path.trim() || path.length > TOOL_SUMMARY_LIMIT || /[\u0000-\u001F\u007F]/.test(path)) return undefined;
  return typeof offset === 'number' && Number.isSafeInteger(offset) && offset > 0 ? { path, line: offset } : { path };
}

const DENIED_TOOL_CODES = new Set(['APPROVAL_REJECTED', 'AUTO_REVIEW_DENIED', 'FS_SANDBOX_DENIED', 'FS_PERMISSION_DENIED', 'HOOK_DENIED', 'HOOK_BLOCKED']);

function toolResultOf(data: Json, message: Json): ToolResult {
  const error = isObject(data.error) ? data.error : {};
  const meta = isObject(data.meta) ? data.meta : {};
  const body = text(message.content);
  const clipped = body.length > TOOL_OUTPUT_LIMIT;
  const reason = typeof error.reason === 'string' && error.reason.trim() ? preview(error.reason, TOOL_OUTPUT_LIMIT) : undefined;
  const file = fileTarget(meta.path, meta.offset);
  const page = publishedPage(meta);
  return {
    // Keep the first screen and the status markers at the end, even if the call
    // is on an older page and the reader expands its result much later.
    output: preview(body, TOOL_OUTPUT_LIMIT),
    outputLength: body.length,
    ...(clipped ? { tail: body.slice(-512) } : {}),
    ...(typeof error.reason === 'string' && error.reason.length > TOOL_OUTPUT_LIMIT ? { reasonClipped: true } : {}),
    isError: message.isError === true,
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(reason ? { reason } : {}),
    ...(file ? { file } : {}),
    ...(page ? { page } : {}),
  };
}

export function settleTool(call: Extract<ConversationItem, { kind: 'tool' }>, outcome: ToolResult): typeof call {
  const command = toolKey(call.name) === 'tools.command';
  const ending = outcome.tail ?? outcome.output;
  const denied = DENIED_TOOL_CODES.has(outcome.code ?? '') ||
    (outcome.isError && /^Error: the user rejected tool "/.test(outcome.output)) ||
    (command && /^\[sandbox: file access denied under [^\r\n]+ mode\]$/m.test(ending));
  const exit = command ? /(?:^|\r?\n)\[exit code: (-?\d+|null)\]\s*$/.exec(ending) : null;
  const signal = command && /(?:^|\n)\[killed by signal: [^\]\n]+\]\s*$/.test(ending);
  // The relay's frame limiter appends an ellipsis only at one of these string caps.
  const bridgeClipped = ending.endsWith('…') && [1024, 4096, 16384, 65536].some((cap) => outcome.outputLength === cap || outcome.outputLength === cap + 1);
  const truncated = bridgeClipped || /(?:^|\n)\[(?:output truncated;|some output was dropped from memory;)/.test(ending);
  const failed = outcome.isError || signal || (exit?.[1] != null && exit[1] !== '0');
  const exitCode = exit && exit[1] !== 'null' ? Number(exit[1])
    : command && outcome.output && !exit && !failed && !denied && !call.background && !truncated &&
      !/\[(?:still running|timed out|stopped|running in background)/i.test(ending) ? 0 : undefined;
  const status = denied ? 'denied' : failed ? 'failed' : 'done';
  const bodyLength = exit ? outcome.outputLength - ending.length + exit.index : outcome.outputLength;
  const body = command || status !== 'done'
    ? (outcome.reason ?? outcome.output.slice(0, bodyLength))
    : '';
  const detail = body || exitCode !== undefined ? {
    output: preview(body, TOOL_OUTPUT_LIMIT),
    truncated: truncated || (outcome.reason ? outcome.reasonClipped === true : bodyLength > TOOL_OUTPUT_LIMIT),
    ...(Number.isSafeInteger(exitCode) ? { exitCode } : {}),
  } : undefined;
  const file = call.file && (outcome.file
    ? { ...call.file, ...outcome.file } : call.file);
  return { ...call, status, ...(file ? { file } : {}), ...(detail ? { detail } : {}) };
}

/** The page a `teamwork_page` result's `meta` names, when it names one completely. */
function publishedPage(meta: unknown): PublishedPage | null {
  if (!isObject(meta) || !isObject(meta.teamworkPage)) return null;
  const p = meta.teamworkPage;
  const kinds = ['html', 'markdown', 'svg'];
  return typeof p.teamId === 'string' && typeof p.pageId === 'string' && typeof p.version === 'number' &&
    typeof p.title === 'string' && typeof p.kind === 'string' && kinds.includes(p.kind)
    ? { teamId: p.teamId, pageId: p.pageId, version: p.version, title: p.title, kind: p.kind as PublishedPage['kind'] }
    : null;
}

export function toolPage(call: Extract<ConversationItem, { kind: 'tool' }>, outcome: ToolResult): Extract<ConversationItem, { kind: 'page' }> | undefined {
  if (call.name === 'teamwork_page' && call.status === 'done' && outcome.page) {
    return { kind: 'page', id: `page-${call.id}`, page: outcome.page };
  }
}

/**
 * What one committed session event means to the screen, given the state so
 * far (a tool result needs the call it answers). Most events mean nothing.
 */
export function eventsOf(event: unknown, state: Pick<SessionState, 'items'>): SessionChange[] {
  if (!isObject(event) || typeof event.type !== 'string') return [];
  const data = isObject(event.data) ? event.data : {};
  const id = `seq-${String(event.seq)}`;
  switch (event.type) {
    case 'user/message': {
      const source = isObject(data.source) ? data.source.kind : undefined;
      if (source === 'schedule') {
        // An automation task's delivery is the member's own instruction, sent for them; DSH's change notices are the agent's.
        const reminders = remindersOf(text(data.content));
        return reminders.length ? [{ type: 'item', item: { kind: 'user', id, text: reminders.map((each) => each.prompt).join('\n\n'), reminders } }] : [];
      }
      if (source !== 'user') return [];
      const said = text(data.content);
      const attachments = Array.isArray(data.content)
        ? data.content.flatMap((part) => {
            if (!isObject(part) || !['file', 'image'].includes(String(part.type)) || !isObject(part.attachment))
              return [];
            const file = part.attachment;
            return typeof file.attachmentId === 'string' && typeof file.bytes === 'number'
              ? [
                  {
                    attachmentId: file.attachmentId,
                    name: typeof file.name === 'string' ? file.name : '',
                    bytes: file.bytes,
                  },
                ]
              : [];
          })
        : [];
      return said || attachments.length
        ? [{ type: 'item', item: { kind: 'user', id, text: said, ...(attachments.length ? { attachments } : {}) } }]
        : [];
    }
    case 'assistant/message': {
      const content = isObject(data.message) ? data.message.content : undefined;
      const said = text(content);
      const reasoning = preview(visibleReasoning(text(content, 'reasoning')), REASONING_LIMIT);
      const turn = typeof data.turn === 'number' ? data.turn : undefined;
      // The streamed text of the same step has this id, so the committed reply replaces it.
      const step = typeof data.turn === 'number' && typeof data.step === 'number' ? replyId(data.turn, data.step) : id;
      return said || reasoning.trim() ? [{ type: 'item', item: {
        kind: 'assistant', id: step, text: said,
        ...(reasoning.trim() ? { reasoning, turn } : {}),
        ...(data.interrupted === true ? { interrupted: true } : {}),
      } }] : [];
    }
    case 'deliverables/presented': {
      const { turn, callId, files } = data;
      if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1 || typeof callId !== 'string' || !callId || !Array.isArray(files)) return [];
      return files.flatMap((entry: unknown, index): SessionChange[] => {
        if (!isObject(entry) || (entry.description !== undefined && typeof entry.description !== 'string')) return [];
        const file = fileTarget(entry.path);
        if (!file || /^[a-z][a-z0-9+.-]*:\/\//i.test(file.path)) return [];
        const description = typeof entry.description === 'string' ? preview(entry.description, TOOL_SUMMARY_LIMIT) : '';
        return [{ type: 'item', item: { kind: 'deliverable', id: `${id}-file-${index}`, turn, file, ...(description ? { description } : {}) } }];
      });
    }
    case 'tool/call': {
      if (typeof data.callId !== 'string') return [];
      const name = String(data.name ?? '');
      const key = toolKey(name);
      const args = toolArgs(data.arguments);
      const target = args.file_path ?? args.path;
      const file = key === 'tools.read' || key === 'tools.write' || key === 'tools.edit'
        ? fileTarget(target, key === 'tools.read' ? args.offset : undefined) : undefined;
      const summary = [args.command, target, args.query, args.url, args.description].find((value): value is string => typeof value === 'string');
      const item: ConversationItem = {
        kind: 'tool', id: data.callId, name, status: 'running',
        summary: preview(summary ?? '', TOOL_SUMMARY_LIMIT),
        ...(typeof data.turn === 'number' ? { turn: data.turn } : {}),
        ...(file ? { file } : {}),
        ...(key === 'tools.command' && args.run_in_background === true ? { background: true } : {}),
      };
      return [{ type: 'item', item }];
    }
    case 'tool/result': {
      const message = isObject(data.message) ? data.message : {};
      const callId = message.toolCallId;
      if (typeof callId !== 'string') return [];
      const result = toolResultOf(data, message);
      const call = state.items.find((item) => item.kind === 'tool' && item.id === callId);
      if (!call || call.kind !== 'tool') return [{ type: 'item', item: { kind: 'tool-result', id: `result-${callId}`, callId, result } }];
      const settled = settleTool(call, result);
      const page = toolPage(settled, result);
      return [{ type: 'item', item: settled }, ...(page ? [{ type: 'item' as const, item: page }] : [])];
    }
    case 'turn/start':
      return [{ type: 'status', status: 'running' }];
    case 'turn/end': {
      const reason = isObject(data.reason) ? data.reason : {};
      const failure = reason.kind === 'error' && isObject(reason.error) ? reason.error : null;
      const end: SessionChange[] = typeof data.turn === 'number'
        ? [{ type: 'item', item: { kind: 'turn-end', id: `turn-end-${data.turn}`, turn: data.turn, completed: reason.kind === 'completed' } }]
        : [];
      if (!failure) return [...end, { type: 'status', status: 'idle' }];
      const message = typeof failure.message === 'string' ? failure.message : '';
      // DSH's words when a turn starts with no model selected (dsh-agent-loop's preStep).
      const noModel = message.includes('has no provider/model');
      return [
        ...end,
        { type: 'item', item: { kind: 'failed', id, message, noModel } },
        { type: 'status', status: 'idle' },
      ];
    }
    default:
      return [];
  }
}

/** One reply per agent step: streamed and committed text share this id. */
const replyId = (turn: number, step: number) => `assistant-${turn}-${step}`;

/** Which step each streaming attempt belongs to, and whether it has shown text yet. One per follow. */
export interface Streams {
  attempts: Map<string, { id: string; turn: number; shown: boolean }>;
}
export const newStreams = (): Streams => ({ attempts: new Map() });

/**
 * One `assistant-stream` frame (`session/follow` with `assistantStream: true`):
 * text deltas become a reply that grows as the model writes. A retried attempt
 * starts its step's reply over; tool calls and usage are not shown.
 */
export function streamEventsOf(frame: unknown, streams: Streams): SessionChange[] {
  if (!isObject(frame) || typeof frame.attemptId !== 'string') return [];
  if (frame.type === 'start' && typeof frame.turn === 'number' && typeof frame.step === 'number') {
    streams.attempts.set(frame.attemptId, { id: replyId(frame.turn, frame.step), turn: frame.turn, shown: false });
    return [];
  }
  const attempt = streams.attempts.get(frame.attemptId);
  if (!attempt) return [];
  if (frame.type === 'end') {
    streams.attempts.delete(frame.attemptId);
    const outcome = isObject(frame.outcome) ? frame.outcome : null;
    return outcome?.kind === 'abandoned' || outcome?.eventType === 'assistant/attempt'
      ? [{ type: 'discard-draft', id: attempt.id }]
      : [];
  }
  const chunk = isObject(frame.chunk) ? frame.chunk : {};
  const reasoning = chunk.type === 'reasoning-delta';
  if (frame.type !== 'chunk' || (!reasoning && chunk.type !== 'text-delta') || typeof chunk.text !== 'string' || !chunk.text) return [];
  if (attempt.shown) return [{ type: 'delta', id: attempt.id, text: chunk.text, ...(reasoning ? { reasoning: true, turn: attempt.turn } : {}) }];
  attempt.shown = true;
  return [{ type: 'item', item: {
    kind: 'assistant', id: attempt.id, text: reasoning ? '' : chunk.text, streaming: true,
    ...(reasoning ? { reasoning: preview(chunk.text, REASONING_LIMIT), turn: attempt.turn } : {}),
  } }];
}

/**
 * A window of history (a follow's opening snapshot, or a `session/page`), folded into items; and the event older
 * history is read before, or null when the window begins at the session's start.
 */
export function historyOf(frame: unknown): Pick<SessionState, 'items' | 'status' | 'earlier'> {
  const records = isObject(frame) && Array.isArray(frame.records) ? frame.records : [];
  let state: SessionState = { status: 'idle', items: [], pending: null, closed: null, earlier: null };
  for (const record of records) {
    const event = isObject(record) ? record.event : undefined;
    for (const change of eventsOf(event, state)) state = applyChange(state, change);
  }
  const first = isObject(records[0]) && isObject(records[0].event) ? records[0].event.seq : undefined;
  const earlier = isObject(frame) && frame.hasMore === true && typeof first === 'number' ? first : null;
  return { items: state.items, status: state.status, earlier };
}

/** A follow's opening snapshot, folded into the state the screen starts from. */
export function snapshotOf(frame: unknown, streams = newStreams()): SessionState {
  let state: SessionState = { ...historyOf(frame), pending: null, closed: null };
  streams.attempts.clear();
  const baseline = isObject(frame) && isObject(frame.assistantStream) ? frame.assistantStream : null;
  const active = isObject(baseline?.activeAttempt) ? baseline.activeAttempt : null;
  if (active && typeof active.turn === 'number' && typeof active.step === 'number' && Array.isArray(active.stream)) {
    const id = replyId(active.turn, active.step);
    // Current DSH snapshots pack adjacent text deltas. Earlier hosts can send raw chunks.
    const records: unknown[] = active.stream;
    const collect = (kind: 'text' | 'reasoning') => records.flatMap((record) => {
      if (!isObject(record)) return [];
      if (record.type === `${kind}-chunks` && Array.isArray(record.texts)) {
        return record.texts.filter((part: unknown): part is string => typeof part === 'string');
      }
      const chunk = record.type === 'chunk' ? record.chunk : record;
      return isObject(chunk) && chunk.type === `${kind}-delta` && typeof chunk.text === 'string' ? [chunk.text] : [];
    }).join('');
    const written = collect('text');
    const reasoning = preview(collect('reasoning'), REASONING_LIMIT);
    // A follow can open between the durable message and the stream's terminal frame.
    if (state.items.some((item) => item.id === id)) return state;
    if (typeof active.attemptId === 'string') streams.attempts.set(active.attemptId, { id, turn: active.turn, shown: !!(written || reasoning) });
    if (written || reasoning) {
      state = applyChange(state, { type: 'item', item: {
        kind: 'assistant', id, text: written, streaming: true, ...(reasoning ? { reasoning, turn: active.turn } : {}),
      } });
    }
    if (written || reasoning || typeof active.attemptId === 'string') state = { ...state, status: 'running' };
  }
  return state;
}

/** Folds one change into a session. Pure, so a reducer can use it. */
export function applyChange<S extends SessionState<unknown>>(state: S, change: SessionChange): S {
  switch (change.type) {
    case 'status':
      return { ...state, status: change.status as SessionStatus };
    case 'item': {
      const at = state.items.findIndex((i) => i.id === change.item.id);
      if (at === -1) return { ...state, items: [...state.items, change.item] };
      const items = state.items.slice();
      items[at] = change.item;
      return { ...state, items };
    }
    case 'discard-draft':
      return { ...state, items: state.items.filter((item) => item.id !== change.id || item.kind !== 'assistant' || !item.streaming) };
    case 'delta':
      return {
        ...state,
        items: state.items.map((item) => {
          if (item.id !== change.id || item.kind !== 'assistant' || !item.streaming) return item;
          return change.reasoning
            ? { ...item, reasoning: preview((item.reasoning ?? '') + change.text, REASONING_LIMIT), turn: change.turn }
            : { ...item, text: item.text + change.text };
        }),
      };
  }
}

/** One question of a `user-questions/request` batch. */
export interface Question {
  id: string;
  question: string;
  options: string[];
}

/** What the agent waits on, read from a `$events` waterfall; null for any other event. */
export type Waiting =
  | { kind: 'questions'; eventId: string; agentId: string; questions: Question[] }
  | { kind: 'approval'; eventId: string; agentId: string; toolName: string; reason: string };

export function waitingOf(frame: unknown, locale: string): Waiting | null {
  if (!isObject(frame) || frame.type !== 'waterfall' || typeof frame.eventId !== 'string' || typeof frame.agentId !== 'string') return null;
  const request = isObject(frame.request) ? frame.request : {};
  if (frame.event === 'user-questions/request') {
    const questions = (Array.isArray(request.questions) ? request.questions : []).flatMap((q): Question[] => {
      if (!isObject(q) || typeof q.id !== 'string' || typeof q.question !== 'string') return [];
      const options = (Array.isArray(q.options) ? q.options : []).flatMap((o) => (isObject(o) && typeof o.label === 'string' ? [o.label] : []));
      return [{ id: q.id, question: q.question, options }];
    });
    return questions.length ? { kind: 'questions', eventId: frame.eventId, agentId: frame.agentId, questions } : null;
  }
  if (frame.event === 'approval/request') {
    const display = isObject(request.displayReason) ? request.displayReason : {};
    const reason = [display[locale], display.en, request.reason].find((r) => typeof r === 'string');
    return { kind: 'approval', eventId: frame.eventId, agentId: frame.agentId, toolName: String(request.toolName ?? ''), reason: typeof reason === 'string' ? reason : '' };
  }
  return null;
}

/**
 * The card for a waiting request, `answered` questions in: a batch is asked one
 * question at a time, and answered together once the last one is.
 */
export function pendingOf(waiting: Waiting, answered: number): Pending {
  if (waiting.kind === 'approval') return { kind: 'approval', id: waiting.eventId, title: waiting.toolName, detail: waiting.reason };
  const q = waiting.questions[answered]!;
  return { kind: 'question', id: `${waiting.eventId}#${answered}`, question: q.question, options: q.options.map((label) => ({ id: label, label })) };
}

/** The value `$events/result` carries for a finished batch of answers, in DSH's `ask_user_question` shape. */
export function questionsResult(waiting: Extract<Waiting, { kind: 'questions' }>, selected: string[]) {
  return { answers: waiting.questions.map((q, i) => ({ id: q.id, selected: [selected[i]!] })) };
}

/** DSH's approval outcomes (`dsh-user-approval`): a one-shot grant or a rejection. */
export const approvalResult = (approve: boolean) => (approve ? 'allowed-once' : 'rejected');
