/**
 * A session followed through a server that passes DSH's own streams on
 * unchanged, one item at a time, each named by its stream: `session/follow`
 * (a snapshot of the records, then each committed event and each reply as it
 * is written) and `$events` (what the agent asks its member, and withdraws).
 * The hosted cloud's `…/sessions/{id}/stream` sends these
 * (premium/docs/tech/saas-route.md); the web page and the phone app fold them
 * with the same functions, read as the relay's own `follow` reads a paired
 * computer's (`live.ts`). Pure, so a screen keeps it in a reducer and the
 * tests replay recorded frames through it.
 */
import {
  applyChange,
  approvalResult,
  eventsOf,
  newStreams,
  pendingOf,
  questionsResult,
  snapshotOf,
  streamEventsOf,
  waitingOf,
  type Streams,
  type Waiting,
} from './dsh';
import type { Answer, Pending, SessionState } from './types';

/** One item of one of a session's streams, as the server relays it. */
export type RelayedFrame = { stream: 'follow' | 'events'; value: unknown };

export interface RelayedSession {
  state: SessionState;
  streams: Streams;
  /** DSH's id for the session, from the follow's snapshot: what it waits on is asked of this agent. */
  session: string | null;
  /** The client id the $events stream was given, which an answer goes back under. */
  client: string | null;
  waiting: Waiting[];
  /** The answers chosen so far for a batch of questions, asked one at a time. */
  answered: Record<string, string[]>;
}

export const EMPTY_RELAYED_SESSION: RelayedSession = {
  state: { status: 'idle', items: [], pending: null, closed: null, earlier: null },
  streams: newStreams(),
  session: null,
  client: null,
  waiting: [],
  answered: {},
};

/** A session that is not running, from the opening snapshot its archive was read into. */
export const relayedFromSnapshot = (snapshot: unknown): RelayedSession => ({
  ...EMPTY_RELAYED_SESSION,
  state: snapshotOf(snapshot),
  streams: newStreams(),
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Folds one frame in; `locale` picks the language an approval's reason is shown in. */
export function receiveRelayed(followed: RelayedSession, frame: RelayedFrame, locale: string): RelayedSession {
  const value = isObject(frame.value) ? frame.value : {};
  if (frame.stream === 'follow') {
    if (value.type === 'snapshot') {
      const header = isObject(value.header) ? value.header : {};
      return { ...followed, state: snapshotOf(value), streams: newStreams(), session: typeof header.id === 'string' ? header.id : followed.session };
    }
    const changes =
      value.type === 'event' ? eventsOf(value.event, followed.state) : value.type === 'assistant-stream' ? streamEventsOf(value.frame, followed.streams, followed.state) : [];
    let state = followed.state;
    for (const change of changes) state = applyChange(state, change);
    return state === followed.state ? followed : { ...followed, state };
  }
  if (value.type === 'ready' && typeof value.clientId === 'string') {
    // What still waits is asked again on every open.
    return { ...followed, client: value.clientId, waiting: [], answered: {} };
  }
  if (value.type === 'waterfall') {
    const waiting = waitingOf(value, locale);
    return waiting && !followed.waiting.some((w) => w.eventId === waiting.eventId) ? { ...followed, waiting: [...followed.waiting, waiting] } : followed;
  }
  if (value.type === 'cancel' && typeof value.eventId === 'string') return withoutRelayedEvent(followed, value.eventId);
  if (value.type === 'emit' && value.event === 'api-session/status' && Array.isArray(value.args) && value.args[0] === followed.session) {
    return { ...followed, state: applyChange(followed.state, { type: 'status', status: value.args[1] === true ? 'running' : 'idle' }) };
  }
  return followed;
}

/** What the session's own agent waits on now, one question of a batch at a time; null when nothing does. */
export function relayedPending(followed: RelayedSession): Pending | null {
  const waiting = followed.waiting.find((w) => w.agentId === followed.session);
  return waiting ? pendingOf(waiting, followed.answered[waiting.eventId]?.length ?? 0) : null;
}

/**
 * The member's answer to what is pending: either the next question of a batch
 * is due (`next`), or the value DSH takes, to send under the stream's client
 * id (`send`). Null when the answer is for something no longer waiting.
 */
export function answerRelayed(
  followed: RelayedSession,
  pendingId: string,
  answer: Answer,
): { next: RelayedSession } | { send: { clientId: string; eventId: string; value: unknown } } | null {
  const eventId = pendingId.split('#')[0]!;
  const waiting = followed.waiting.find((w) => w.eventId === eventId);
  if (!waiting || !followed.client) return null;
  if (waiting.kind === 'approval' && answer.kind === 'approval') return { send: { clientId: followed.client, eventId, value: approvalResult(answer.approve) } };
  if (waiting.kind !== 'questions' || answer.kind !== 'question') return null;
  const selected = [...(followed.answered[eventId] ?? []), answer.optionId];
  if (selected.length < waiting.questions.length) return { next: { ...followed, answered: { ...followed.answered, [eventId]: selected } } };
  return { send: { clientId: followed.client, eventId, value: questionsResult(waiting, selected) } };
}

/** The session once an answer has been taken, or DSH withdrew the request. */
export function withoutRelayedEvent(followed: RelayedSession, eventId: string): RelayedSession {
  const answered = { ...followed.answered };
  delete answered[eventId];
  return { ...followed, waiting: followed.waiting.filter((w) => w.eventId !== eventId), answered };
}
