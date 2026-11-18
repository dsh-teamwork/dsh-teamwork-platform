/**
 * Reading DSH's Remote API into the app's shapes, against frames recorded from
 * a real DeepSeek Harness through the relay (fixtures/dsh-session.json): a
 * session created from the phone, a prompt, a question the agent asked and the
 * phone answered, and the reply.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/dsh-session.json';

import {
  approvalResult,
  eventsOf,
  latestDirectoryOf,
  newStreams,
  pendingOf,
  questionsResult,
  sessionsOf,
  snapshotOf,
  streamEventsOf,
  waitingOf,
} from '../dsh';
import { applySessionEvent } from '../session';
import type { SessionState } from '../types';

describe('reading DSH', () => {
  it('lists sessions with their titles, newest first, without blank ones', () => {
    const sessions = sessionsOf(fixture.sessionList);
    expect(sessions[0]).toMatchObject({ title: 'Should I deploy?', status: 'idle' });
    expect(sessions.map((s) => s.updatedAt)).toEqual([...sessions.map((s) => s.updatedAt)].sort().reverse());
    expect(sessionsOf({ items: [{ sessionId: 's', blank: true, updatedAt: 1 }] })).toEqual([]);
  });

  it('reads a running turn’s step from the plugin, and nothing from an idle session or an older plugin', () => {
    const item = (running: boolean, teamworkStep?: unknown) => ({ sessionId: 's', updatedAt: 1, running, cwd: '/a/app', projections: { values: { title: 't', teamworkStep } } });
    const step = { turn: 2, count: 7, tool: 'edit', target: 'server/relay/relay_test.go' };
    expect(sessionsOf({ items: [item(true, step)] })[0]!.step).toEqual({ count: 7, tool: 'edit', target: 'server/relay/relay_test.go' });
    expect(sessionsOf({ items: [item(false, step)] })[0]!.step).toBeNull();
    expect(sessionsOf({ items: [item(true, { ...step, count: 0 })] })[0]!.step).toBeNull();
    expect(sessionsOf({ items: [item(true)] })[0]!.step).toBeNull();
  });

  it('shows what was said and done, and none of DSH’s own messages', () => {
    const state = snapshotOf(fixture.followSnapshot);
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant']);
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'Should I deploy?' });
    expect(state.items[1]).toMatchObject({ kind: 'tool', id: 'call_q', name: 'ask_user_question', status: 'done' });
    expect(state.items[2]).toMatchObject({ kind: 'assistant', text: expect.stringContaining('The phone answered') });
    expect(state.status).toBe('idle');
  });

  it('folds live events into the same conversation the snapshot shows', () => {
    let state: SessionState = { status: 'idle', items: [], pending: null, closed: null };
    const statuses: string[] = [];
    for (const event of fixture.followEvents) {
      for (const change of eventsOf(event, state)) {
        state = applySessionEvent(state, change);
        if (change.type === 'status') statuses.push(change.status);
      }
    }
    expect(statuses).toEqual(['running', 'idle']);
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant']);
  });

  it('turns a question waterfall into one card per question, and the answers into DSH’s shape', () => {
    const waterfall = fixture.events.find((e) => e.type === 'waterfall')!;
    const waiting = waitingOf(waterfall, 'en');
    expect(waiting).toMatchObject({ kind: 'questions', agentId: waterfall.agentId, questions: [{ id: 'go', question: 'Deploy to staging?', options: ['Yes', 'No'] }] });
    if (waiting?.kind !== 'questions') throw new Error('expected questions');
    expect(pendingOf(waiting, 0)).toEqual({
      kind: 'question',
      id: `${waiting.eventId}#0`,
      question: 'Deploy to staging?',
      options: [
        { id: 'Yes', label: 'Yes' },
        { id: 'No', label: 'No' },
      ],
    });
    expect(questionsResult(waiting, ['Yes'])).toEqual({ answers: [{ id: 'go', selected: ['Yes'] }] });
  });

  it('turns an approval waterfall into an approval card in the reader’s language', () => {
    const frame = {
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'e1',
      agentId: 's1',
      request: { toolName: 'bash', callId: 'c1', reason: 'raw', displayReason: { en: 'Run the tests', fr: 'Lancer les tests' } },
    };
    const waiting = waitingOf(frame, 'fr')!;
    expect(pendingOf(waiting, 0)).toEqual({ kind: 'approval', id: 'e1', title: 'bash', detail: 'Lancer les tests' });
    expect(pendingOf(waitingOf(frame, 'de')!, 0)).toMatchObject({ detail: 'Run the tests' });
    expect([approvalResult(true), approvalResult(false)]).toEqual(['allowed-once', 'rejected']);
    expect(waitingOf({ type: 'emit', event: 'api-session/status' }, 'en')).toBeNull();
  });

  it('shows a reply as it is written, and the committed reply replaces it rather than repeating it', () => {
    let state: SessionState = { status: 'idle', items: [], pending: null, closed: null };
    const streams = newStreams();
    const replies: string[] = [];
    for (const frame of fixture.followWithStream) {
      const changes = frame.type === 'event' ? eventsOf((frame as { event: unknown }).event, state) : streamEventsOf((frame as { frame: unknown }).frame, streams, state);
      for (const change of changes) {
        state = applySessionEvent(state, change);
        if (change.type === 'item' && change.item.kind === 'assistant') replies.push(change.item.text);
        if (change.type === 'delta') replies.push(`+${change.text}`);
      }
    }
    // Streamed first, piece by piece, then the committed text under the same id.
    expect(replies[0]).toBe('The phone answered: ');
    expect(replies[1]).toMatch(/^\+\["\{/);
    expect(state.items.filter((i) => i.kind === 'assistant')).toHaveLength(1);
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant']);
  });

  it('opens a session with the reply being written so far', () => {
    const state = snapshotOf({
      records: [],
      assistantStream: { revision: 3, activeAttempt: { turn: 2, step: 1, stream: [{ type: 'block-start' }, { type: 'text-delta', text: 'Half ' }, { type: 'text-delta', text: 'way' }] } },
    });
    expect(state.items).toEqual([{ kind: 'assistant', id: 'assistant-2-1', text: 'Half way' }]);
  });

  it('starts a new session in the folder of the computer’s latest one', () => {
    expect(latestDirectoryOf(fixture.sessionList)).toBe('/home/ada/project');
    expect(latestDirectoryOf({ items: [{ cwd: '/a', updatedAt: 1 }, { cwd: '/b', updatedAt: 9 }] })).toBe('/b');
    expect(latestDirectoryOf({ items: [] })).toBeNull();
  });
});

it('keeps file-only desktop messages visible in history', () => {
  const events = eventsOf(
    {
      type: 'user/message',
      seq: 3,
      data: {
        source: { kind: 'user' },
        content: [{ type: 'file', attachment: { attachmentId: 'hash', name: 'report.pdf', bytes: 42 } }],
      },
    },
    { items: [] },
  );
  expect(events).toEqual([
    {
      type: 'item',
      item: {
        kind: 'user',
        id: 'seq-3',
        text: '',
        attachments: [{ attachmentId: 'hash', name: 'report.pdf', bytes: 42 }],
      },
    },
  ]);
});
