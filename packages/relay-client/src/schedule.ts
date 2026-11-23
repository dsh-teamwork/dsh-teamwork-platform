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
 * - A form on the web or the phone holds a `TaskDraft`; `taskInput` and `taskPatch` turn it into what DSH takes.
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

/** How a form offers a task's repeat: the timings a client writes. A custom rule (RRULE) is read, never written. */
export type TaskRepeat = 'once' | 'every' | 'daily' | 'weekly' | 'cron';

/**
 * A task as a form holds it, the same on the web and the phone: text a person types, turned into DSH's input by
 * `taskInput` and `taskPatch`.
 */
export interface TaskDraft {
  title: string;
  prompt: string;
  repeat: TaskRepeat;
  /** `once`: a local date and time on this device, `YYYY-MM-DDTHH:mm`. */
  at: string;
  /** `every`: whole minutes between runs. */
  minutes: string;
  /** `daily` and `weekly`: `HH:mm`. */
  time: string;
  /** `weekly`: ISO weekdays, Monday 1 to Sunday 7. */
  weekdays: number[];
  expression: string;
  /** `daily`, `weekly` and `cron`: an IANA zone. */
  timeZone: string;
  destination: 'new_once' | 'new' | 'session';
  /** `session`, and a reused session's own once it has one. */
  sessionId: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** An instant as this device's local `YYYY-MM-DDTHH:mm`. */
export function localDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** A local `YYYY-MM-DDTHH:mm` (a space for the `T` too) as an instant, read by its parts: Hermes parses no zone-less string reliably. */
export function localInstant(text: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(text.trim());
  if (!parts) return null;
  const [, y, mo, d, h, mi] = parts.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 ? date : null;
}
/** This device's IANA zone, where it knows one. */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * A form's starting values: a task's own, or a new one's, tomorrow at nine on weekdays in this device's zone, in a
 * session of its own unless `sessionId` names one.
 */
export function taskDraft(task: AutomationTask | undefined, sessionId: string, now = new Date(), timeZone = deviceTimeZone()): TaskDraft {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const draft: TaskDraft = {
    title: task?.title ?? '', prompt: task?.prompt ?? '', repeat: 'daily', at: localDateTime(tomorrow), minutes: '60', time: '09:00',
    weekdays: [1, 2, 3, 4, 5], expression: '0 9 * * 1-5', timeZone,
    destination: sessionId ? 'session' : 'new_once', sessionId,
  };
  if (!task) return draft;
  const timing = task.timing;
  if (timing.kind === 'at' || timing.kind === 'after') Object.assign(draft, { repeat: 'once', at: localDateTime(new Date(task.scheduledAt)) });
  else if (timing.kind === 'every') Object.assign(draft, { repeat: 'every', minutes: String(Math.max(1, Math.round(timing.everySeconds / 60))) });
  else if (timing.kind === 'daily') Object.assign(draft, { repeat: 'daily', time: timing.time.slice(0, 5), timeZone: timing.timeZone });
  else if (timing.kind === 'weekly') Object.assign(draft, { repeat: 'weekly', time: timing.time.slice(0, 5), timeZone: timing.timeZone, weekdays: timing.weekdays });
  else if (timing.kind === 'cron') Object.assign(draft, { repeat: 'cron', expression: timing.expression, timeZone: timing.timeZone });
  // A reserved session is shown as the one it reuses.
  draft.destination = task.target.kind;
  draft.sessionId = task.target.kind === 'new' ? '' : task.target.sessionId;
  return draft;
}

/** A draft's timing in DSH's management input. */
export function draftTiming(draft: TaskDraft): TimingInput {
  switch (draft.repeat) {
    case 'once': return { kind: 'at', at: (localInstant(draft.at) ?? new Date(NaN)).toISOString() };
    case 'every': return { kind: 'every', every_seconds: Math.round(Number(draft.minutes) * 60) };
    case 'daily': return { kind: 'daily', daily: { time: `${draft.time.trim()}:00`, time_zone: draft.timeZone.trim() } };
    case 'weekly': return { kind: 'weekly', weekly: { time: `${draft.time.trim()}:00`, time_zone: draft.timeZone.trim(), weekdays: [...draft.weekdays].sort() } };
    case 'cron': return { kind: 'cron', cron: { expression: draft.expression.trim(), time_zone: draft.timeZone.trim() } };
  }
}

function draftTarget(draft: TaskDraft): TargetInput {
  return draft.destination === 'session' ? { kind: 'session', sessionId: draft.sessionId } : { kind: draft.destination };
}

/** What a new task sends. */
export function taskInput(draft: TaskDraft): TaskInput {
  return { title: draft.title.trim(), prompt: draft.prompt.trim(), timing: draftTiming(draft), target: draftTarget(draft) };
}

/**
 * What an edit of `task` sends: its name and instruction, its timing unless it is a custom rule a form cannot write,
 * and its destination only when it changed, since sending a reused session's again would reserve another one.
 */
export function taskPatch(task: AutomationTask, draft: TaskDraft): TaskPatch {
  const before = taskDraft(task, '');
  const moved = draft.destination !== before.destination || draft.sessionId !== before.sessionId;
  return {
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    ...(task.timing.kind === 'rrule' ? {} : { timing: draftTiming(draft) }),
    ...(moved ? { target: draftTarget(draft) } : {}),
  };
}

/** Whether a draft is complete enough to send (`timingFixed` for a custom rule kept as it is); what DSH refuses beyond this, it says. */
export function draftReady(draft: TaskDraft, timingFixed: boolean): boolean {
  if (!draft.title.trim() || draft.title.trim().length > TASK_TITLE_MAX || !draft.prompt.trim()) return false;
  if (draft.destination === 'session' && !draft.sessionId) return false;
  if (timingFixed) return true;
  if (draft.repeat === 'once') return localInstant(draft.at) !== null;
  if (draft.repeat === 'every') return Number.isInteger(Number(draft.minutes)) && Number(draft.minutes) >= 1;
  if ((draft.repeat === 'daily' || draft.repeat === 'weekly') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time.trim())) return false;
  if (draft.repeat === 'weekly' && draft.weekdays.length === 0) return false;
  if (draft.repeat === 'cron' && !draft.expression.trim()) return false;
  return !!draft.timeZone.trim();
}
