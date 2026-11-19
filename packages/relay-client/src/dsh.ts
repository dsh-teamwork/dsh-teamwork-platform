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
 *   (`user/message` from `source.kind: 'user'`), what the agent said
 *   (`assistant/message` text) and its tool calls become items; the system
 *   prompt, runtime context and bookkeeping events are DSH's own.
 * - `$events` waterfalls → `Pending`: `user-questions/request` and
 *   `approval/request`, answered through `$events/result`.
 */

import type { ConversationItem, Pending, PublishedPage, SessionChange, SessionState, SessionStatus, SessionSummary } from './types';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (content: unknown) =>
  Array.isArray(content)
    ? content
        .filter((part): part is { type: 'text'; text: string } => isObject(part) && part.type === 'text' && typeof part.text === 'string')
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
    marks: isObject(item.teamwork) ? { pinned: item.teamwork.pinned === true, archived: item.teamwork.archived === true } : null,
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

/** A tool call's arguments, short enough for one line. */
function summarize(args: unknown): string {
  if (typeof args !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(args);
    if (isObject(parsed)) {
      const first = ['command', 'path', 'file_path', 'query', 'url', 'description'].map((k) => parsed[k]).find((v) => typeof v === 'string');
      if (typeof first === 'string') return first;
    }
  } catch {
    // Not JSON: show it as it came.
  }
  return args;
}

/** The page a `teamwork_page` result's `meta` names, when it names one completely. */
function publishedPage(tool: string, meta: unknown): PublishedPage | null {
  if (tool !== 'teamwork_page' || !isObject(meta) || !isObject(meta.teamworkPage)) return null;
  const p = meta.teamworkPage;
  const kinds = ['html', 'markdown', 'svg'];
  return typeof p.teamId === 'string' && typeof p.pageId === 'string' && typeof p.version === 'number' &&
    typeof p.title === 'string' && typeof p.kind === 'string' && kinds.includes(p.kind)
    ? { teamId: p.teamId, pageId: p.pageId, version: p.version, title: p.title, kind: p.kind as PublishedPage['kind'] }
    : null;
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
      const said = text(isObject(data.message) ? data.message.content : undefined);
      // The streamed text of the same step has this id, so the committed reply replaces it.
      const step = typeof data.turn === 'number' && typeof data.step === 'number' ? replyId(data.turn, data.step) : id;
      return said ? [{ type: 'item', item: { kind: 'assistant', id: step, text: said } }] : [];
    }
    case 'tool/call': {
      if (typeof data.callId !== 'string') return [];
      const item: ConversationItem = { kind: 'tool', id: data.callId, name: String(data.name ?? ''), summary: summarize(data.arguments), status: 'running' };
      return [{ type: 'item', item }];
    }
    case 'tool/result': {
      const message = isObject(data.message) ? data.message : {};
      const callId = message.toolCallId;
      const call = state.items.find((i) => i.kind === 'tool' && i.id === callId);
      if (!call || call.kind !== 'tool') return [];
      const done: SessionChange[] = [{ type: 'item', item: { ...call, status: message.isError === true ? 'failed' : 'done' } }];
      const page = message.isError === true ? null : publishedPage(call.name, data.meta);
      return page ? [...done, { type: 'item', item: { kind: 'page', id: `page-${call.id}`, page } }] : done;
    }
    case 'turn/start':
      return [{ type: 'status', status: 'running' }];
    case 'turn/end': {
      const reason = isObject(data.reason) ? data.reason : {};
      const failure = reason.kind === 'error' && isObject(reason.error) ? reason.error : null;
      if (!failure) return [{ type: 'status', status: 'idle' }];
      const message = typeof failure.message === 'string' ? failure.message : '';
      // DSH's words when a turn starts with no model selected (dsh-agent-loop's preStep).
      const noModel = message.includes('has no provider/model');
      return [
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
  attempts: Map<string, { id: string; shown: boolean }>;
}
export const newStreams = (): Streams => ({ attempts: new Map() });

/**
 * One `assistant-stream` frame (`session/follow` with `assistantStream: true`):
 * text deltas become a reply that grows as the model writes. A retried attempt
 * starts its step's reply over; tool calls and usage are not shown.
 */
export function streamEventsOf(frame: unknown, streams: Streams, state: Pick<SessionState, 'items'>): SessionChange[] {
  if (!isObject(frame) || typeof frame.attemptId !== 'string') return [];
  if (frame.type === 'start' && typeof frame.turn === 'number' && typeof frame.step === 'number') {
    streams.attempts.set(frame.attemptId, { id: replyId(frame.turn, frame.step), shown: false });
    return [];
  }
  const attempt = streams.attempts.get(frame.attemptId);
  if (!attempt) return [];
  if (frame.type === 'end') {
    streams.attempts.delete(frame.attemptId);
    return [];
  }
  const chunk = isObject(frame.chunk) ? frame.chunk : {};
  if (frame.type !== 'chunk' || chunk.type !== 'text-delta' || typeof chunk.text !== 'string' || !chunk.text) return [];
  if (attempt.shown && state.items.some((i) => i.id === attempt.id)) return [{ type: 'delta', id: attempt.id, text: chunk.text }];
  attempt.shown = true;
  return [{ type: 'item', item: { kind: 'assistant', id: attempt.id, text: chunk.text } }];
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
export function snapshotOf(frame: unknown): SessionState {
  let state: SessionState = { ...historyOf(frame), pending: null, closed: null };
  // A reply being written when the follow opened: its text so far.
  const active = isObject(frame) && isObject(frame.assistantStream) && isObject(frame.assistantStream.activeAttempt) ? frame.assistantStream.activeAttempt : null;
  if (active && typeof active.turn === 'number' && typeof active.step === 'number' && Array.isArray(active.stream)) {
    const written = active.stream.map((c) => (isObject(c) && c.type === 'text-delta' && typeof c.text === 'string' ? c.text : '')).join('');
    if (written) state = applyChange(state, { type: 'item', item: { kind: 'assistant', id: replyId(active.turn, active.step), text: written } });
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
    case 'delta':
      return {
        ...state,
        items: state.items.map((item) => (item.id === change.id && item.kind === 'assistant' ? { ...item, text: item.text + change.text } : item)),
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
