/**
 * Reading DSH's Remote API into the app's shapes, against frames recorded from
 * a real DeepSeek Harness through the relay (fixtures/dsh-session.json): a
 * session created from the phone, a prompt, a question the agent asked and the
 * phone answered, and the reply.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/dsh-session.json';

import {
  applyChange,
  approvalResult,
  eventsOf,
  historyOf,
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

  it('puts pinned sessions after those waiting on the member and keeps archived ones, marked, for the screen to hide', () => {
    const item = (sessionId: string, updatedAt: number, teamwork?: unknown, running = false) => ({ sessionId, updatedAt, running, cwd: '/a/app', projections: { values: { title: sessionId } }, teamwork });
    const sessions = sessionsOf(
      { items: [item('new', 5, { pinned: false, archived: false }), item('pinned', 1, { pinned: true, archived: false }), item('running', 2, { pinned: false, archived: false }, true), item('archived', 9, { pinned: false, archived: true }), item('waiting', 0)] },
      new Map([['waiting', { kind: 'question', id: 'q', question: '?', options: [] }]]),
    );
    expect(sessions.map((s) => s.id)).toEqual(['waiting', 'pinned', 'running', 'archived', 'new']);
    expect(sessions.find((s) => s.id === 'archived')!.marks).toEqual({ pinned: false, archived: true });
    // An older plugin marks nothing, and the screens offer no action on it.
    expect(sessions.find((s) => s.id === 'waiting')!.marks).toBeNull();
  });

  it('shows what was said and done, and none of DSH’s own messages', () => {
    const state = snapshotOf(fixture.followSnapshot);
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant']);
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'Should I deploy?' });
    expect(state.items[1]).toMatchObject({ kind: 'tool', id: 'call_q', name: 'ask_user_question', status: 'done' });
    expect(state.items[2]).toMatchObject({ kind: 'assistant', text: expect.stringContaining('The phone answered') });
    expect(state.status).toBe('idle');
  });

  it('says where older history begins only when the window does not reach the session’s start', () => {
    const said = (seq: number) => ({ type: 'event', event: { type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `m${seq}` }] } } });
    expect(historyOf({ records: [said(7), said(9)], hasMore: true })).toMatchObject({ earlier: 7, items: [{ id: 'seq-7' }, { id: 'seq-9' }] });
    expect(historyOf({ records: [said(0)], hasMore: false }).earlier).toBeNull();
    expect(snapshotOf(fixture.followSnapshot).earlier).toBeNull();
    const older = applySessionEvent({ ...snapshotOf({ records: [said(9)], hasMore: true }) }, { type: 'older', items: historyOf({ records: [said(7), said(9)] }).items, earlier: null });
    expect(older.items.map((i) => i.id)).toEqual(['seq-7', 'seq-9']);
    expect(older.earlier).toBeNull();
  });

  it('folds live events into the same conversation the snapshot shows', () => {
    let state: SessionState = { status: 'idle', items: [], pending: null, closed: null, earlier: null };
    const statuses: string[] = [];
    for (const event of fixture.followEvents) {
      for (const change of eventsOf(event, state)) {
        state = applyChange(state, change);
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
    let state: SessionState = { status: 'idle', items: [], pending: null, closed: null, earlier: null };
    const streams = newStreams();
    const replies: string[] = [];
    for (const frame of fixture.followWithStream) {
      const changes = frame.type === 'event' ? eventsOf((frame as { event: unknown }).event, state) : streamEventsOf((frame as { frame: unknown }).frame, streams, state);
      for (const change of changes) {
        state = applyChange(state, change);
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

it('shows a turn that failed, and says when it had no model', () => {
  const end = (seq: number, reason: unknown) => eventsOf({ type: 'turn/end', seq, data: { turn: 1, reason } }, { items: [] });
  expect(end(4, { kind: 'completed' })).toEqual([{ type: 'status', status: 'idle' }]);
  expect(end(5, { kind: 'aborted', reason: { kind: 'user' } })).toEqual([{ type: 'status', status: 'idle' }]);
  expect(end(6, { kind: 'error', error: { message: 'Out of credit', code: 'UNKNOWN' } })).toEqual([
    { type: 'item', item: { kind: 'failed', id: 'seq-6', message: 'Out of credit', noModel: false } },
    { type: 'status', status: 'idle' },
  ]);
  const message = 'agent "a1" has no provider/model: set AgentOptions.provider and AgentOptions.model or record a model selection';
  expect(end(7, { kind: 'error', error: { message, code: 'UNKNOWN' } })[0]).toEqual({
    type: 'item',
    item: { kind: 'failed', id: 'seq-7', message, noModel: true },
  });
});

describe('a page the agent published', () => {
  const call = { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'teamwork_page', arguments: '{"action":"create"}' } };
  const page = { teamId: 't1', pageId: 'p1', version: 2, title: 'Q4', kind: 'html' };
  const result = (meta: unknown, isError = false, name = 'teamwork_page') => ({
    type: 'tool/result',
    seq: 2,
    data: { message: { role: 'tool', toolCallId: 'c1', isError, content: [] }, meta, name },
  });
  const run = (events: unknown[]) => {
    let state: SessionState = { status: 'idle', items: [], pending: null, closed: null, earlier: null };
    for (const event of events) for (const change of eventsOf(event, state)) state = applyChange(state, change);
    return state.items;
  };

  it('follows the tool that published it, from the result’s meta', () => {
    expect(run([call, result({ teamworkPage: page })])).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'c1', status: 'done' }),
      { kind: 'page', id: 'page-c1', page },
    ]);
  });

  it('is nothing when the call failed, another tool reported it, or the meta is incomplete', () => {
    expect(run([call, result({ teamworkPage: page }, true)]).map((i) => i.kind)).toEqual(['tool']);
    expect(run([{ ...call, data: { ...call.data, name: 'bash' } }, result({ teamworkPage: page })]).map((i) => i.kind)).toEqual(['tool']);
    expect(run([call, result({ teamworkPage: { ...page, version: '2' } })]).map((i) => i.kind)).toEqual(['tool']);
    expect(run([call, result({ teamworkPage: { ...page, kind: 'pdf' } })]).map((i) => i.kind)).toEqual(['tool']);
  });
});
