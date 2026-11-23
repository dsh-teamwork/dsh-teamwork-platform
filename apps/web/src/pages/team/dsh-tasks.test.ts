import { describe, expect, it } from 'vitest';

import { taskOf } from '@dsh-teamwork/relay-client';
import { draftOf, taskInputOf, taskPatchOf, timingOf } from './dsh-tasks';

// A task as DSH 0.2.2-rc.4 answered it in the probe (docs/tech/automation-tasks.md).
const reused = taskOf({
  id: 'schedule-1cab', kind: 'daily', title: 'Probe new_once', prompt: 'Say hi.', time: '09:00:00.000', timeZone: 'Asia/Shanghai',
  scheduledAt: '2026-11-24T01:00:00.000Z', target: { kind: 'new_once', sessionId: 'session-bc15', create: {} },
  involvedSessionIds: ['session-bc15'], status: 'active', createdAt: '2026-11-23T03:27:47.007Z', updatedAt: '2026-11-23T03:27:47.007Z',
})!;

describe('the automation task form', () => {
  it('writes each repeat in DSH\'s management input', () => {
    const draft = { ...draftOf(undefined, ''), timeZone: 'Asia/Shanghai', time: '23:30' };
    expect(timingOf({ ...draft, repeat: 'daily' })).toEqual({ kind: 'daily', daily: { time: '23:30:00', time_zone: 'Asia/Shanghai' } });
    expect(timingOf({ ...draft, repeat: 'weekly', weekdays: [5, 1, 3] })).toEqual({ kind: 'weekly', weekly: { time: '23:30:00', time_zone: 'Asia/Shanghai', weekdays: [1, 3, 5] } });
    expect(timingOf({ ...draft, repeat: 'every', minutes: '15' })).toEqual({ kind: 'every', every_seconds: 900 });
    expect(timingOf({ ...draft, repeat: 'cron', expression: ' */15 9-17 * * 1-5 ' })).toEqual({ kind: 'cron', cron: { expression: '*/15 9-17 * * 1-5', time_zone: 'Asia/Shanghai' } });
    // A local date and time is this browser's; DSH takes the instant.
    expect(timingOf({ ...draft, repeat: 'once', at: '2099-01-01T09:00' })).toEqual({ kind: 'at', at: new Date('2099-01-01T09:00').toISOString() });
  });

  it('starts a new task in a session of its own, or in the session it was asked for from', () => {
    expect(taskInputOf({ ...draftOf(undefined, ''), title: ' Deploy ', prompt: ' Check it. ' })).toMatchObject({ title: 'Deploy', prompt: 'Check it.', target: { kind: 'new_once' } });
    expect(taskInputOf({ ...draftOf(undefined, 'session-1'), title: 'a', prompt: 'b' }).target).toEqual({ kind: 'session', sessionId: 'session-1' });
  });

  it('reads a task back into the form, and sends its destination only when it changed', () => {
    const draft = draftOf(reused, '');
    expect(draft).toMatchObject({ repeat: 'daily', time: '09:00', timeZone: 'Asia/Shanghai', destination: 'new_once', sessionId: 'session-bc15' });
    // Sending new_once again would reserve another session: an edit of the name alone keeps it.
    expect(taskPatchOf(reused, { ...draft, title: 'Renamed' })).toEqual({ title: 'Renamed', prompt: 'Say hi.', timing: { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } } });
    expect(taskPatchOf(reused, { ...draft, destination: 'new' }).target).toEqual({ kind: 'new' });
    expect(taskPatchOf(reused, { ...draft, destination: 'session', sessionId: 'session-2' }).target).toEqual({ kind: 'session', sessionId: 'session-2' });
  });

  it('keeps a custom rule as it is', () => {
    const custom = { ...reused, timing: { kind: 'rrule' as const, rrule: 'DTSTART;TZID=Asia/Shanghai:20990101T090000\nRRULE:FREQ=DAILY' } };
    expect(taskPatchOf(custom, { ...draftOf(custom, ''), prompt: 'New' })).toEqual({ title: 'Probe new_once', prompt: 'New' });
  });
});
