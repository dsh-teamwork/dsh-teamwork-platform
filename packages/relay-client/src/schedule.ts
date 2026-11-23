/**
 * A computer's automation tasks (the server's `docs/tech/automation-tasks.md`): DSH's Schedule, reached through the
 * plugin's `schedule/*` calls and read into a client's shapes. DSH keeps and delivers the tasks; nothing here is stored.
 *
 * - A task as DSH answers it (`schedule/catalog`, `create`, `edit`, `run`) is read by `taskOf`; one DSH writes in a shape
 *   this module does not know is left out rather than guessed at.
 * - A non-mutating miss comes back as a value (`{ id, code }`), not an error; `taskResult` turns it into the
 *   `RelayError` the screens word.
 * - A delivery lands in its session as a user message framed `[SCHEDULE REMINDER]` (or `… BATCH`); `remindersOf`
 *   reads the instructions out of that framing. `[SCHEDULE CHANGE]` notices are for the agent, and read as nothing.
 */

import { RelayError, type RelayErrorCode } from './types';

/** When a task runs, as DSH stores it. `rrule` is shown, never written, by a client. */
export type TaskTiming =
  | { kind: 'after'; afterSeconds: number }
  | { kind: 'at' }
  | { kind: 'every'; everySeconds: number }
  | { kind: 'daily'; time: string; timeZone: string }
  | { kind: 'weekly'; time: string; timeZone: string; weekdays: number[] }
  | { kind: 'cron'; expression: string; timeZone: string }
  | { kind: 'rrule'; rrule: string };

/** Where a task delivers: one session, one session made at the first run and reused, or a new one every run. */
export type TaskTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new_once'; sessionId: string; cwd?: string; agentPreset?: string }
  | { kind: 'new'; cwd?: string; agentPreset?: string };

export interface AutomationTask {
  id: string;
  title: string;
  prompt: string;
  timing: TaskTiming;
  /** The next occurrence, or the last one of a task that ended; ISO UTC. */
  scheduledAt: string;
  target: TaskTarget;
  status: 'active' | 'paused' | 'ended';
  /** The revision an edit sends back; null for a task DSH stored before it kept one. */
  updatedAt: string | null;
  /** A delivery is queued or running in its reused session. */
  running: boolean;
  lastDelivery: { deliveredAt: string; sessionId: string } | null;
}

/** One saved delivery: when it was due, when the session accepted it, where, and what it sent. */
export interface TaskDelivery {
  scheduledAt: string;
  deliveredAt: string;
  sessionId: string;
  prompt: string | null;
}

/** One page of a task's deliveries, newest first. */
export interface TaskHistory {
  deliveries: TaskDelivery[];
  /** The cursor for the next, older page; null on the last. */
  before: string | null;
  /** Deliveries older than these may have existed and are not kept. */
  earlierUnavailable: boolean;
}

/** When a new task runs, in DSH's management input (snake case, as DSH reads it). */
export type TimingInput =
  | { kind: 'after'; after_seconds: number }
  | { kind: 'at'; at: string }
  | { kind: 'every'; every_seconds: number }
  | { kind: 'daily'; daily: { time: string; time_zone: string } }
  | { kind: 'weekly'; weekly: { time: string; time_zone: string; weekdays: number[] } }
  | { kind: 'cron'; cron: { expression: string; time_zone: string } };

/** Where a new or edited task delivers; DSH reserves a `new_once` session itself. */
export type TargetInput =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new_once' | 'new'; create?: { cwd?: string; agentPreset?: string } };

export interface TaskInput {
  title: string;
  prompt: string;
  timing: TimingInput;
  target?: TargetInput;
}

/** What an edit changes; `active: false` pauses, `true` resumes from the next future occurrence. */
export interface TaskPatch {
  title?: string;
  prompt?: string;
  timing?: TimingInput;
  target?: TargetInput;
  active?: boolean;
}

/** The most a task's title may hold, as DSH counts it. */
export const TASK_TITLE_MAX = 120;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function timingOf(value: Json): TaskTiming | null {
  const timeZone = str(value.timeZone);
  const time = str(value.time);
  switch (value.kind) {
    case 'after': { const afterSeconds = num(value.afterSeconds); return afterSeconds === undefined ? null : { kind: 'after', afterSeconds }; }
    case 'at': return { kind: 'at' };
    case 'every': { const everySeconds = num(value.everySeconds); return everySeconds === undefined ? null : { kind: 'every', everySeconds }; }
    case 'daily': return time && timeZone ? { kind: 'daily', time, timeZone } : null;
    case 'weekly': {
      const weekdays = Array.isArray(value.weekdays) && value.weekdays.every((day) => typeof day === 'number') ? (value.weekdays as number[]) : undefined;
      return time && timeZone && weekdays ? { kind: 'weekly', time, timeZone, weekdays } : null;
    }
    case 'cron': { const expression = str(value.expression); return expression && timeZone ? { kind: 'cron', expression, timeZone } : null; }
    case 'rrule': { const rrule = str(value.rrule); return rrule ? { kind: 'rrule', rrule } : null; }
    default: return null;
  }
}

function targetOf(value: unknown): TaskTarget | null {
  if (!isObject(value)) return null;
  const create = isObject(value.create) ? value.create : {};
  const made = { ...(str(create.cwd) ? { cwd: str(create.cwd) } : {}), ...(str(create.agentPreset) ? { agentPreset: str(create.agentPreset) } : {}) };
  const sessionId = str(value.sessionId);
  if (value.kind === 'session') return sessionId ? { kind: 'session', sessionId } : null;
  if (value.kind === 'new_once') return sessionId ? { kind: 'new_once', sessionId, ...made } : null;
  if (value.kind === 'new') return { kind: 'new', ...made };
  return null;
}

/** One task as DSH answers it, or null for anything else (a miss, or a shape this client does not know). */
export function taskOf(value: unknown): AutomationTask | null {
  if (!isObject(value)) return null;
  const id = str(value.id), title = str(value.title), prompt = str(value.prompt), scheduledAt = str(value.scheduledAt);
  const timing = timingOf(value);
  const target = targetOf(value.target);
  const status = value.status === 'active' || value.status === 'paused' || value.status === 'ended' ? value.status : undefined;
  if (!id || title === undefined || prompt === undefined || !scheduledAt || !timing || !target || !status) return null;
  const last = isObject(value.lastDelivery) ? value.lastDelivery : undefined;
  const deliveredAt = str(last?.deliveredAt), lastSession = str(last?.targetSessionId);
  return {
    id, title, prompt, timing, scheduledAt, target, status,
    updatedAt: str(value.updatedAt) ?? null,
    running: value.executionActive === true,
    lastDelivery: deliveredAt && lastSession ? { deliveredAt, sessionId: lastSession } : null,
  };
}

/** Every task in a `schedule/catalog` answer, in DSH's order: active first. */
export function tasksOf(value: unknown): AutomationTask[] {
  return Array.isArray(value) ? value.flatMap((entry) => taskOf(entry) ?? []) : [];
}

/** DSH's non-mutating misses, in the words the screens have. */
const MISSES: Record<string, RelayErrorCode> = {
  schedule_not_found: 'not_found',
  delivery_cursor_not_found: 'not_found',
  schedule_conflict: 'schedule_conflict',
  schedule_ended: 'schedule_ended',
  schedule_execution_pending: 'busy',
};

/** A `create`, `edit` or `run` answer as its task; a miss, or a task this client cannot read, is a `RelayError`. */
export function taskResult(value: unknown): AutomationTask {
  const task = taskOf(value);
  if (task) return task;
  throw new RelayError(MISSES[str(isObject(value) ? value.code : undefined) ?? ''] ?? 'unavailable');
}

/** A delete's answer: done, or the miss it is. */
export function deletedResult(value: unknown): void {
  if (isObject(value) && value.deleted === true) return;
  throw new RelayError(MISSES[str(isObject(value) ? value.code : undefined) ?? ''] ?? 'unavailable');
}

/** A `schedule/history` page. */
export function historyResult(value: unknown): TaskHistory {
  if (!isObject(value) || !Array.isArray(value.records)) throw new RelayError(MISSES[str(isObject(value) ? value.code : undefined) ?? ''] ?? 'unavailable');
  const deliveries = value.records.flatMap((record): TaskDelivery[] => {
    if (!isObject(record)) return [];
    const scheduledAt = str(record.scheduledAt), deliveredAt = str(record.deliveredAt), sessionId = str(record.targetSessionId);
    return scheduledAt && deliveredAt && sessionId ? [{ scheduledAt, deliveredAt, sessionId, prompt: str(record.prompt) ?? null }] : [];
  });
  return { deliveries, before: str(value.nextBefore) ?? null, earlierUnavailable: value.earlierRecordsUnavailable === true };
}

/** One delivered instruction, as a session shows it. */
export interface Reminder {
  scheduleId: string;
  occurrenceAt: string;
  prompt: string;
}

/** The value after `key: ` on one of the framing's lines, JSON-decoded when the key says so; undefined if absent. */
function framed(lines: string[], key: string): unknown {
  const line = lines.find((each) => each.startsWith(`${key}: `));
  if (line === undefined) return undefined;
  const raw = line.slice(key.length + 2);
  if (!key.endsWith('_json')) return raw;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/**
 * The instructions a schedule-sourced message delivered, read from DSH's framing; an empty list for a change notice or
 * any text this client does not recognise (DSH 0.2.2-rc.4's `renderReminderFraming` and batch framing).
 */
export function remindersOf(text: string): Reminder[] {
  const lines = text.split('\n');
  if (lines[0] === '[SCHEDULE REMINDER]') {
    const scheduleId = framed(lines, 'schedule_id_json'), occurrenceAt = framed(lines, 'occurrence_at'), prompt = framed(lines, 'reminder_prompt_json');
    return typeof scheduleId === 'string' && typeof occurrenceAt === 'string' && typeof prompt === 'string' ? [{ scheduleId, occurrenceAt, prompt }] : [];
  }
  if (lines[0] === '[SCHEDULE REMINDER BATCH]') {
    const batch = framed(lines, 'reminders_json');
    if (!Array.isArray(batch)) return [];
    return batch.flatMap((entry): Reminder[] => {
      if (!isObject(entry)) return [];
      const scheduleId = str(entry.schedule_id), occurrenceAt = str(entry.occurrence_at), prompt = str(entry.reminder_prompt);
      return scheduleId && occurrenceAt && prompt !== undefined ? [{ scheduleId, occurrenceAt, prompt }] : [];
    });
  }
  return [];
}
