/**
 * A computer's automation tasks, read from what DSH 0.2.2-rc.4 answered the bridge's identity in the probe of
 * docs/tech/automation-tasks.md, and driven through a link the test scripts.
 */
import { describe, expect, it } from 'vitest';
import { bridgeValue, createDshSessions, type DshLink } from '../dsh-sessions';
import { eventsOf } from '../dsh';
import { remindersOf, taskOf, tasksOf } from '../schedule';
import { RelayError } from '../types';

const cron = {
  id: 'schedule-4baf', kind: 'cron', title: 'Probe cron', prompt: 'x', expression: '*/15 9-17 * * 1-5', timeZone: 'Asia/Shanghai',
  scheduledAt: '2026-11-23T03:30:00.000Z', target: { kind: 'new_once', sessionId: 'session-002d', create: {} },
  involvedSessionIds: ['session-002d'], status: 'active', createdAt: '2026-11-23T03:27:47.037Z', updatedAt: '2026-11-23T03:27:47.037Z',
};
const ran = {
  id: 'schedule-89d3', kind: 'at', title: 'Probe session', prompt: 'Say hi.', scheduledAt: '2026-11-23T04:27:46.977Z',
  target: { kind: 'session', sessionId: 'session-259d' }, involvedSessionIds: ['session-259d'], status: 'paused',
  createdAt: '2026-11-23T03:27:46.983Z', updatedAt: '2026-11-23T03:27:47.104Z', executionActive: true, deliveryFloorEndsAt: '2026-11-23T03:28:47.080Z',
  lastDelivery: { scheduledAt: '2026-11-23T03:27:47.080Z', deliveredAt: '2026-11-23T03:27:47.104Z', messageId: 'cd01', targetSessionId: 'session-259d' },
};
const daily = { ...cron, id: 'schedule-1cab', kind: 'daily', expression: undefined, time: '09:00:00.000', timeZone: 'Asia/Shanghai' };

describe('a computer\'s automation tasks', () => {
  it('reads every timing, target and status DSH answers, and leaves out what it cannot read', () => {
    expect(taskOf(cron)).toEqual({
      id: 'schedule-4baf', title: 'Probe cron', prompt: 'x', timing: { kind: 'cron', expression: '*/15 9-17 * * 1-5', timeZone: 'Asia/Shanghai' },
      scheduledAt: '2026-11-23T03:30:00.000Z', target: { kind: 'new_once', sessionId: 'session-002d' }, status: 'active',
      updatedAt: '2026-11-23T03:27:47.037Z', running: false, lastDelivery: null,
    });
    expect(taskOf(ran)).toMatchObject({ timing: { kind: 'at' }, target: { kind: 'session', sessionId: 'session-259d' }, status: 'paused', running: true,
      lastDelivery: { deliveredAt: '2026-11-23T03:27:47.104Z', sessionId: 'session-259d' } });
    expect(taskOf(daily)?.timing).toEqual({ kind: 'daily', time: '09:00:00.000', timeZone: 'Asia/Shanghai' });
    expect(taskOf({ ...cron, kind: 'weekly', time: '09:00:00.000', weekdays: [1, 3] })?.timing).toEqual({ kind: 'weekly', time: '09:00:00.000', timeZone: 'Asia/Shanghai', weekdays: [1, 3] });
    expect(taskOf({ ...cron, kind: 'rrule', rrule: 'DTSTART;TZID=Asia/Shanghai:20990101T090000\nRRULE:FREQ=DAILY' })?.timing.kind).toBe('rrule');
    expect(taskOf({ ...cron, target: { kind: 'new', create: { cwd: '/work', agentPreset: 'review' } } })?.target).toEqual({ kind: 'new', cwd: '/work', agentPreset: 'review' });
    // A task stored before revisions has none to send back.
    expect(taskOf({ ...cron, updatedAt: undefined })?.updatedAt).toBeNull();
    // A miss, a kind this client does not know, a status it does not know.
    expect(taskOf({ id: 'x', code: 'schedule_not_found' })).toBeNull();
    expect(tasksOf([cron, { ...cron, kind: 'yearly' }, { ...cron, status: 'inactive' }, daily]).map((task) => task.id)).toEqual(['schedule-4baf', 'schedule-1cab']);
    expect(tasksOf(null)).toEqual([]);
  });

  it('reads the instructions out of a delivery, and nothing out of a change notice', () => {
    expect(remindersOf('[SCHEDULE REMINDER]\nThis is a scheduled message from the user\nschedule_id_json: "schedule-f6ff"\noccurrence_at: 2026-11-23T03:28:00.023Z\nreminder_prompt_json: "Say hi.\\nThen stop."'))
      .toEqual([{ scheduleId: 'schedule-f6ff', occurrenceAt: '2026-11-23T03:28:00.023Z', prompt: 'Say hi.\nThen stop.' }]);
    expect(remindersOf(`[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ${JSON.stringify([
      { schedule_id: 'a', occurrence_at: '2026-11-23T01:00:00.000Z', reminder_prompt: 'One' },
      { schedule_id: 'b', occurrence_at: '2026-11-23T01:00:00.000Z', reminder_prompt: 'Two' },
    ])}`).map((each) => each.prompt)).toEqual(['One', 'Two']);
    expect(remindersOf('[SCHEDULE CHANGE]\nA scheduled task involving this session was changed outside this session.\nchange: created\nschedule_id_json: "s"\nschedule_title_json: "t"')).toEqual([]);
    expect(remindersOf('[SCHEDULE REMINDER]\nreminder_prompt_json: not json')).toEqual([]);
  });

  it('shows a delivery as the member\'s own turn with its reminders, and hides DSH\'s change notices', () => {
    const delivered = { type: 'user/message', seq: 13, data: { source: { kind: 'schedule' }, role: 'user', content: [{ type: 'text',
      text: '[SCHEDULE REMINDER]\nThis is a scheduled message from the user\nschedule_id_json: "schedule-f6ff"\noccurrence_at: 2026-11-23T03:28:00.023Z\nreminder_prompt_json: "Say hi."' }] } };
    expect(eventsOf(delivered, { items: [] })).toEqual([{ type: 'item', item: { kind: 'user', id: 'seq-13', text: 'Say hi.',
      reminders: [{ scheduleId: 'schedule-f6ff', occurrenceAt: '2026-11-23T03:28:00.023Z', prompt: 'Say hi.' }] } }]);
    const notice = { type: 'user/message', seq: 11, data: { source: { kind: 'schedule' }, role: 'user', content: [{ type: 'text',
      text: '[SCHEDULE CHANGE]\nA scheduled task involving this session was changed outside this session.\nchange: created\nschedule_id_json: "s"\nschedule_title_json: "t"' }] } };
    expect(eventsOf(notice, { items: [] })).toEqual([]);
  });

  it('calls DSH\'s schedule methods, words its misses and refusals, and refreshes on schedule/changed', async () => {
    const calls: Array<{ method: string; args: unknown }> = [];
    let onEvents: (body: Record<string, unknown>) => void = () => {};
    const answers: Record<string, unknown> = {
      'schedule/catalog': [cron, ran],
      'schedule/create': cron,
      'schedule/run': { id: 'schedule-89d3', code: 'schedule_execution_pending' },
      'schedule/history': { id: 'schedule-89d3', records: [{ scheduledAt: 'a', deliveredAt: 'b', messageId: 'm', targetSessionId: 'session-259d', prompt: 'Say hi.' }],
        earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 }, nextBefore: 'm' },
    };
    const link: DshLink = {
      async call(_computer, method, args) {
        calls.push({ method, args });
        if (method === 'schedule/edit') {
          const request = (args as { request: { action: string } }).request;
          return request.action === 'delete' ? { id: 'schedule-89d3', deleted: true } : { id: 'schedule-89d3', code: 'schedule_conflict' };
        }
        return answers[method];
      },
      async open(_computer, endpoint, _args, onBody) {
        if (endpoint === '$events') onEvents = onBody;
        return 'st1';
      },
      close() {},
    };
    const sessions = createDshSessions(link, { locale: () => 'en', nextId: () => 'id' });

    expect((await sessions.listTasks('c')).map((task) => task.id)).toEqual(['schedule-4baf', 'schedule-89d3']);
    const input = { title: 'Deploy check', prompt: 'Check the deploy.', timing: { kind: 'cron' as const, cron: { expression: '0 9 * * 1-5', time_zone: 'Asia/Shanghai' } } };
    expect((await sessions.createTask('c', input)).id).toBe('schedule-4baf');
    const task = taskOf(ran)!;
    await expect(sessions.updateTask('c', task, { active: true })).rejects.toEqual(new RelayError('schedule_conflict'));
    await sessions.deleteTask('c', task);
    await expect(sessions.runTask('c', task.id)).rejects.toEqual(new RelayError('busy'));
    expect(await sessions.taskHistory('c', task.id, 'older')).toEqual({ deliveries: [{ scheduledAt: 'a', deliveredAt: 'b', sessionId: 'session-259d', prompt: 'Say hi.' }], before: 'm', earlierUnavailable: false });
    expect(calls.map((call) => [call.method, call.args])).toEqual([
      ['schedule/catalog', {}],
      ['schedule/create', { request: input }],
      ['schedule/edit', { request: { id: 'schedule-89d3', action: 'update', patch: { active: true }, expectedUpdatedAt: '2026-11-23T03:27:47.104Z' } }],
      ['schedule/edit', { request: { id: 'schedule-89d3', action: 'delete', expectedUpdatedAt: '2026-11-23T03:27:47.104Z' } }],
      ['schedule/run', { request: { id: 'schedule-89d3' } }],
      ['schedule/history', { request: { id: 'schedule-89d3', limit: 20, before: 'older' } }],
    ]);

    let changed = 0;
    const stop = sessions.watchTasks('c', () => changed++);
    await new Promise((resolve) => setTimeout(resolve, 0));
    onEvents({ type: 'item', streamId: 'st1', value: { type: 'emit', event: 'schedule/changed', args: [] } });
    onEvents({ type: 'item', streamId: 'st1', value: { type: 'emit', event: 'api-session/added', args: [{ sessionId: 's' }] } });
    expect(changed).toBe(1);
    stop();
    onEvents({ type: 'item', streamId: 'st1', value: { type: 'emit', event: 'schedule/changed', args: [] } });
    expect(changed).toBe(1);
  });

  it('words a shared DSH\'s refusal, and DSH\'s input refusal with its reason', () => {
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'teamwork/schedule_unavailable' } } })).toThrow(new RelayError('schedule_unavailable'));
    try {
      bridgeValue(200, { result: { ok: false, error: { code: 'schedule/input-invalid', message: 'title is required', details: { code: 'invalid_prompt' } } } });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'schedule_invalid', detail: 'invalid_prompt' });
    }
  });
});
