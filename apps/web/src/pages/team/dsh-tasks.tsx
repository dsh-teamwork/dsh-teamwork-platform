/**
 * A computer's automation tasks (docs/tech/automation-tasks.md, ADR 0066): DSH's Schedule on that computer, reached
 * through the same `SessionClient` as its sessions. My DSH shows them under the computer
 * (`/teams/{teamId}/my-dsh/{hostId}/tasks[/{taskId}]`): the list, a task's detail with its deliveries, and the form
 * that makes or changes one; and in a session, the tasks that deliver to it (`SessionTasks`). The computer keeps and
 * runs them; nothing here is stored. A task runs only while the computer's DSH runs.
 */

import { AlarmClock, ArrowLeft, Pause, Play, PencilLine, Plus, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useLocale, useNow, useTranslations } from 'use-intl';

import {
  deviceTimeZone,
  draftReady,
  RelayError,
  TASK_TITLE_MAX,
  taskDraft,
  taskInput,
  taskPatch,
  type AutomationTask,
  type SessionSummary,
  type TaskDraft,
  type TaskHistory,
  type TaskRepeat,
} from '@dsh-teamwork/relay-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useRelayError, useSessionClient } from './dsh-session';

/** A computer's tasks, read again whenever one changes anywhere (on this browser, a phone, or the computer itself). */
export function useTasks(computerId: string) {
  const client = useSessionClient();
  const word = useRelayError();
  const t = useTranslations('team.tasks');
  const [tasks, setTasks] = useState<AutomationTask[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!computerId) return;
    try {
      setTasks(await client.listTasks(computerId));
      setFailed(null);
    } catch (error) {
      // A plugin from before automation tasks refuses the call.
      setFailed(error instanceof RelayError && error.code === 'configuration_unsupported' ? t('pluginTooOld') : word(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` and `t` are fresh closures each render.
  }, [client, computerId]);
  useEffect(() => {
    setTasks(null);
    setFailed(null);
    if (!computerId) return;
    void reload();
    return client.watchTasks(computerId, () => void reload());
  }, [client, computerId, reload]);
  return { tasks, failed, reload };
}

/** A task's error in the reader's words: DSH's own reason for a refused input, where there is one. */
function useTaskError() {
  const t = useTranslations('team.tasks.invalid');
  const word = useRelayError();
  return (error: unknown) => {
    if (error instanceof RelayError && error.code === 'schedule_invalid' && error.detail && t.has(error.detail)) return t(error.detail);
    return word(error);
  };
}

/** The session a task delivers to next, if it has one yet. */
const targetSession = (task: AutomationTask) => (task.target.kind === 'new' ? undefined : task.target.sessionId);

/** When a task runs, in a sentence. */
function useTimingWords() {
  const t = useTranslations('team.tasks');
  const format = useFormatter();
  const locale = useLocale();
  const weekday = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, day)));
  return (task: AutomationTask) => {
    const timing = task.timing;
    switch (timing.kind) {
      case 'after':
      case 'at':
        return t('timing.once', { at: format.dateTime(new Date(task.scheduledAt), { dateStyle: 'medium', timeStyle: 'short' }) });
      case 'every':
        return timing.everySeconds % 3600 === 0
          ? t('timing.everyHours', { count: timing.everySeconds / 3600 })
          : t('timing.everyMinutes', { count: Math.round(timing.everySeconds / 60) });
      case 'daily':
        return t('timing.daily', { time: timing.time.slice(0, 5), zone: timing.timeZone });
      case 'weekly':
        // 2024-01-01 was a Monday, ISO weekday 1.
        return t('timing.weekly', { days: timing.weekdays.map(weekday).join(', '), time: timing.time.slice(0, 5), zone: timing.timeZone });
      case 'cron':
        return t('timing.cron', { expression: timing.expression, zone: timing.timeZone });
      case 'rrule':
        return t('timing.custom');
    }
  };
}

/** A task's state, and when it runs next while it still does. */
function TaskState({ task }: { task: AutomationTask }) {
  const t = useTranslations('team.tasks');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  if (task.status !== 'active') return <span>{t(`status.${task.status}`)}</span>;
  return <span>{task.running ? t('runningNow') : t('next', { at: format.relativeTime(new Date(task.scheduledAt), now) })}</span>;
}

/**
 * The computer's tasks in the right column: the list (`taskId` ""), the form for a new one (`new`, aimed at the
 * session named in `?session=` when there is one), or one task's detail. `base` is the tasks' own address; a session's
 * address is `sessionsBase/{id}`.
 */
export function TasksPanel({ computerId, base, sessionsBase, taskId, sessions }: {
  computerId: string; base: string; sessionsBase: string; taskId: string; sessions: SessionSummary[] | null;
}) {
  const t = useTranslations('team.tasks');
  const { tasks, failed } = useTasks(computerId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const task = tasks?.find((each) => each.id === taskId);

  if (taskId === 'new') {
    return (
      <TaskForm computerId={computerId} sessions={sessions} back={base} initialSession={params.get('session') ?? ''}
        saved={(made) => navigate(`${base}/${made.id}`, { replace: true })} />
    );
  }
  if (taskId) {
    if (!tasks) return failed ? <p role="alert" className="text-sm text-destructive">{failed}</p> : <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>;
    if (!task) return <NotFound base={base} />;
    return <TaskDetail key={task.id} computerId={computerId} task={task} base={base} sessionsBase={sessionsBase} sessions={sessions} />;
  }
  return <TaskList tasks={tasks} failed={failed} base={base} />;
}

function NotFound({ base }: { base: string }) {
  const t = useTranslations('team.tasks');
  return (
    <section className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">{t('notFound')}</p>
      <Button asChild variant="outline" size="sm"><Link to={base}><ArrowLeft className="size-4" aria-hidden />{t('back')}</Link></Button>
    </section>
  );
}

const GROUPS = ['active', 'paused', 'ended'] as const;

function TaskList({ tasks, failed, base }: { tasks: AutomationTask[] | null; failed: string | null; base: string }) {
  const t = useTranslations('team.tasks');
  const words = useTimingWords();
  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('help')}</p>
        </div>
        <Button asChild size="sm"><Link to={`${base}/new`}><Plus className="size-4" aria-hidden />{t('new')}</Link></Button>
      </header>
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      {tasks === null && !failed && <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>}
      {tasks?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
          <AlarmClock className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('emptyTitle')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('emptyHelp')}</p>
        </div>
      )}
      {tasks && GROUPS.map((status) => {
        const group = tasks.filter((task) => task.status === status);
        return group.length > 0 && (
          <div key={status} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t(`groups.${status}`)}</h3>
            <ul className="flex flex-col divide-y rounded-lg border">
              {group.map((task) => (
                <li key={task.id}>
                  <Link to={`${base}/${task.id}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className="truncate font-medium">{task.title}</span>
                    <span className="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                      <span className="truncate">{words(task)}</span>
                      <span aria-hidden>·</span>
                      <TaskState task={task} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function TaskDetail({ computerId, task, base, sessionsBase, sessions }: {
  computerId: string; task: AutomationTask; base: string; sessionsBase: string; sessions: SessionSummary[] | null;
}) {
  const t = useTranslations('team.tasks');
  const client = useSessionClient();
  const words = useTimingWords();
  const wordError = useTaskError();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const deliversTo = targetSession(task);
  const sessionTitle = (id: string) => sessions?.find((s) => s.id === id)?.title || t('untitledSession');

  async function act(run: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setFailed(null);
    try {
      await run();
      if (done) toast.success(done);
    } catch (error) {
      setFailed(wordError(error));
    } finally {
      setBusy(false);
    }
  }

  if (editing) return <TaskForm computerId={computerId} sessions={sessions} task={task} back={base} cancel={() => setEditing(false)} saved={() => setEditing(false)} />;

  return (
    <section className="flex flex-col gap-5">
      <Link to={base} className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t('title')}
      </Link>
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{task.title}</h2>
        <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
          <span>{words(task)}</span>
          <span aria-hidden>·</span>
          <TaskState task={task} />
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || task.running} onClick={() => void act(() => client.runTask(computerId, task.id), t('ran'))}>
          <Zap className="size-4" aria-hidden />
          {t('runNow')}
        </Button>
        {task.status !== 'ended' && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => client.updateTask(computerId, task, { active: task.status !== 'active' }))}>
              {task.status === 'active' ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {t(task.status === 'active' ? 'pause' : 'resume')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              <PencilLine className="size-4" aria-hidden />
              {t('edit')}
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => {
          if (!confirm(t('deleteConfirm', { title: task.title }))) return;
          void act(async () => {
            await client.deleteTask(computerId, task);
            navigate(base, { replace: true });
          }, t('deleted'));
        }}>
          <Trash2 className="size-4" aria-hidden />
          {t('delete')}
        </Button>
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('instruction')}</dt>
        <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{task.prompt}</dd>
        <dt className="text-muted-foreground">{t('deliversTo')}</dt>
        <dd>
          {deliversTo && (task.target.kind === 'session' || sessions?.some((s) => s.id === deliversTo))
            ? <Link className="underline underline-offset-2" to={`${sessionsBase}/${deliversTo}`}>{sessionTitle(deliversTo)}</Link>
            : t(`targets.${task.target.kind}`)}
        </dd>
      </dl>
      {task.timing.kind === 'rrule' && <p className="text-sm text-muted-foreground">{t('customHelp')}</p>}
      <Deliveries computerId={computerId} task={task} sessionsBase={sessionsBase} sessionTitle={sessionTitle} />
    </section>
  );
}

/** A task's saved deliveries, newest first: when each was sent and to which session. Each says it reached the inbox, not what the agent did. */
function Deliveries({ computerId, task, sessionsBase, sessionTitle }: { computerId: string; task: AutomationTask; sessionsBase: string; sessionTitle: (id: string) => string }) {
  const t = useTranslations('team.tasks');
  const client = useSessionClient();
  const word = useRelayError();
  const format = useFormatter();
  const [history, setHistory] = useState<TaskHistory | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const delivered = task.lastDelivery?.deliveredAt;
  useEffect(() => {
    let live = true;
    client.taskHistory(computerId, task.id).then((page) => live && setHistory(page), (error) => live && setFailed(word(error)));
    return () => { live = false; };
    // A new delivery is a new last delivery: read the first page again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [client, computerId, task.id, delivered]);

  async function more() {
    if (!history?.before) return;
    try {
      const next = await client.taskHistory(computerId, task.id, history.before);
      setHistory({ ...next, deliveries: [...history.deliveries, ...next.deliveries] });
    } catch (error) {
      setFailed(word(error));
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{t('history')}</h3>
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      {history?.deliveries.length === 0 && <p className="text-sm text-muted-foreground">{t('noDeliveries')}</p>}
      {history && history.deliveries.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {history.deliveries.map((delivery) => (
            <li key={`${delivery.deliveredAt}-${delivery.sessionId}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5">
              <span className="tabular-nums">{format.dateTime(new Date(delivery.deliveredAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <Link className="min-w-0 truncate text-muted-foreground underline underline-offset-2" to={`${sessionsBase}/${delivery.sessionId}`}>{sessionTitle(delivery.sessionId)}</Link>
            </li>
          ))}
        </ul>
      )}
      {history?.before && <Button size="sm" variant="ghost" className="self-start" onClick={() => void more()}>{t('moreHistory')}</Button>}
      {history?.earlierUnavailable && !history.before && <p className="text-xs text-muted-foreground">{t('earlierUnavailable')}</p>}
      <p className="text-xs text-muted-foreground">{t('historyHelp')}</p>
    </section>
  );
}

/** Makes a task, or changes `task`: its name, instruction, when it runs and where it delivers. A custom rule is kept as it is. */
function TaskForm({ computerId, sessions, task, back, initialSession = '', cancel, saved }: {
  computerId: string; sessions: SessionSummary[] | null; task?: AutomationTask; back: string; initialSession?: string;
  cancel?: () => void; saved: (task: AutomationTask) => void;
}) {
  const t = useTranslations('team.tasks');
  const client = useSessionClient();
  const wordError = useTaskError();
  const locale = useLocale();
  const [draft, setDraft] = useState(() => taskDraft(task, initialSession));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const set = (change: Partial<TaskDraft>) => setDraft((was) => ({ ...was, ...change }));
  // DSH's custom rules (RRULE) are written on the computer; the form keeps one as it is.
  const timingFixed = task?.timing.kind === 'rrule';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const weekday = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, day)));
  const listed = (sessions ?? []).filter((s) => !s.marks?.archived || s.id === draft.sessionId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      if (!task) {
        saved(await client.createTask(computerId, taskInput(draft)));
        toast.success(t('created'));
        return;
      }
      saved(await client.updateTask(computerId, task, taskPatch(task, draft)));
      toast.success(t('saved'));
    } catch (error) {
      setFailed(wordError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex max-w-2xl flex-col gap-5">
      <Link to={back} onClick={cancel ? (event) => { event.preventDefault(); cancel(); } : undefined} className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {task ? task.title : t('title')}
      </Link>
      <h2 className="text-xl font-semibold tracking-tight">{t(task ? 'editTitle' : 'newTitle')}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">{t('name')}</Label>
        <Input id="task-title" value={draft.title} maxLength={TASK_TITLE_MAX} onChange={(event) => set({ title: event.target.value })} placeholder={t('namePlaceholder')} autoFocus={!task} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-prompt">{t('instruction')}</Label>
        <Textarea id="task-prompt" rows={4} value={draft.prompt} onChange={(event) => set({ prompt: event.target.value })} placeholder={t('instructionPlaceholder')} />
      </div>
      <fieldset className="flex flex-col gap-3" disabled={timingFixed}>
        <legend className="mb-1.5 text-sm font-medium">{t('when')}</legend>
        {timingFixed ? (
          <p className="text-sm text-muted-foreground">{t('customHelp')}</p>
        ) : (
          <>
            <Select label={t('when')} value={draft.repeat} change={(repeat) => set({ repeat: repeat as TaskRepeat })} className="w-full sm:w-64"
              options={(['once', 'every', 'daily', 'weekly', 'cron'] as const).map((value) => ({ value, label: t(`repeat.${value}`) }))} />
            {draft.repeat === 'once' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-at">{t('at')}</Label>
                <Input id="task-at" type="datetime-local" value={draft.at} onChange={(event) => set({ at: event.target.value })} className="w-full sm:w-64" />
                <p className="text-xs text-muted-foreground">{t('atHelp', { zone: deviceTimeZone() })}</p>
              </div>
            )}
            {draft.repeat === 'every' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-minutes">{t('minutes')}</Label>
                <Input id="task-minutes" type="number" min={1} step={1} value={draft.minutes} onChange={(event) => set({ minutes: event.target.value })} className="w-32" />
              </div>
            )}
            {(draft.repeat === 'daily' || draft.repeat === 'weekly') && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-time">{t('time')}</Label>
                <Input id="task-time" type="time" value={draft.time} onChange={(event) => set({ time: event.target.value })} className="w-32" />
              </div>
            )}
            {draft.repeat === 'weekly' && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('weekdays')}>
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const on = draft.weekdays.includes(day);
                  return (
                    <Button key={day} type="button" size="sm" variant={on ? 'default' : 'outline'} aria-pressed={on}
                      onClick={() => set({ weekdays: on ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day] })}>
                      {weekday(day)}
                    </Button>
                  );
                })}
              </div>
            )}
            {draft.repeat === 'cron' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-cron">{t('cron')}</Label>
                <Input id="task-cron" value={draft.expression} onChange={(event) => set({ expression: event.target.value })} className="w-full font-mono sm:w-64" spellCheck={false} />
                <p className="text-xs text-muted-foreground">{t('cronHelp')}</p>
              </div>
            )}
            {draft.repeat !== 'once' && draft.repeat !== 'every' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-zone">{t('zone')}</Label>
                <Input id="task-zone" list="task-zones" value={draft.timeZone} onChange={(event) => set({ timeZone: event.target.value })} className="w-full sm:w-64" spellCheck={false} />
                <datalist id="task-zones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
              </div>
            )}
          </>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t('deliversTo')}</legend>
        {(['new_once', 'new', 'session'] as const).map((value) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="task-destination" className="mt-1 accent-brand" checked={draft.destination === value} onChange={() => set({ destination: value })} />
            <span className="flex flex-col">
              <span>{t(`targets.${value}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`targetHelp.${value}`)}</span>
            </span>
          </label>
        ))}
        {draft.destination === 'session' && (
          <Select label={t('pickSession')} value={draft.sessionId} change={(sessionId) => set({ sessionId })} className="w-full sm:w-96"
            options={[
              ...listed.map((s) => ({ value: s.id, label: s.title || t('untitledSession') })),
              // A session the list does not hold any more (archived elsewhere, or not read yet) stays chosen.
              ...(draft.sessionId && !listed.some((s) => s.id === draft.sessionId) ? [{ value: draft.sessionId, label: t('untitledSession') }] : []),
            ]} />
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t('runsWhileOnline')}</p>
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !draftReady(draft, timingFixed)}>{t(task ? 'save' : 'create')}</Button>
        {cancel ? <Button type="button" variant="outline" onClick={cancel}>{t('cancel')}</Button> : <Button asChild variant="outline"><Link to={back}>{t('cancel')}</Link></Button>}
      </div>
    </form>
  );
}

/** In a session's header: the tasks that deliver to it, each opened in the tasks page, and a new one aimed at it. */
export function SessionTasks({ tasks, sessionId, base }: { tasks: AutomationTask[] | null; sessionId: string; base: string }) {
  const t = useTranslations('team.tasks');
  const words = useTimingWords();
  const mine = (tasks ?? []).filter((task) => task.status !== 'ended' && targetSession(task) === sessionId);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={t('inSession', { count: mine.length })} title={t('inSession', { count: mine.length })}>
          <AlarmClock aria-hidden />
          {mine.length > 0 && <span className="tabular-nums">{mine.length}</span>}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={5} className="z-50 flex w-72 flex-col rounded-lg border bg-card p-1 text-sm text-card-foreground shadow-lg">
          {mine.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t('noneInSession')}</p>}
          {mine.map((task) => (
            <DropdownMenu.Item key={task.id} asChild>
              <Link to={`${base}/${task.id}`} className="flex flex-col rounded-md px-2.5 py-1.5 outline-none data-highlighted:bg-accent">
                <span className="truncate">{task.title}</span>
                <span className="truncate text-xs text-muted-foreground">{words(task)}{task.status === 'paused' ? ` · ${t('status.paused')}` : ''}</span>
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link to={`${base}/new?session=${encodeURIComponent(sessionId)}`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-highlighted:bg-accent">
              <Plus className="size-4" aria-hidden />
              {t('newInSession')}
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Above a member's turn an automation task sent: which task, and when it was due. */
export function ReminderNote({ occurrenceAt, task, base }: { occurrenceAt: string; task?: AutomationTask; base?: string }) {
  const t = useTranslations('team.tasks');
  const format = useFormatter();
  const when = format.dateTime(new Date(occurrenceAt), { dateStyle: 'medium', timeStyle: 'short' });
  const label = task ? t('reminderOf', { title: task.title, at: when }) : t('reminder', { at: when });
  return (
    <p className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
      <AlarmClock className="size-3.5 shrink-0" aria-hidden />
      {task && base ? <Link to={`${base}/${task.id}`} className="truncate hover:text-foreground hover:underline">{label}</Link> : <span className="truncate">{label}</span>}
    </p>
  );
}
