import { describe, expect, it } from 'vitest';

import { rowsOf, visibleConversationRows } from '../conversation';
import { applyChange, eventsOf, newStreams, snapshotOf, streamEventsOf } from '../dsh';
import { EMPTY_SESSION } from '../session';
import fixture from './fixtures/thinking-deliverables.json';

describe('native DSH thinking and deliverables', () => {
  it('keeps reasoning in process order, leaving replies and turn-tail file cards visible when folded', () => {
    let live = EMPTY_SESSION;
    for (const { event } of fixture.records) live = eventsOf(event, live).reduce(applyChange, live);
    const replay = snapshotOf(fixture);
    expect(replay).toEqual(live);
    const rows = rowsOf(live.items);
    expect(rows.map((row) => row.kind)).toEqual([
      'user', 'work', 'steps', 'assistant', 'steps', 'assistant', 'deliverable', 'deliverable', 'user',
    ]);
    expect(rows[2]).toMatchObject({ count: 0, entries: [{ kind: 'reasoning', text: 'Review the **test results**.' }] });
    expect(rows[4]).toMatchObject({ count: 2, entries: [
      { kind: 'tool', id: 'write-report' }, { kind: 'reasoning', text: 'Check the final report.' }, { kind: 'tool', id: 'present-report' },
    ] });
    expect(rows[6]).toMatchObject({ file: { path: 'reports/check notes.md' }, description: 'Workspace check report' });
    expect(visibleConversationRows(rows, () => false).map((row) => row.kind)).toEqual([
      'user', 'work', 'assistant', 'assistant', 'deliverable', 'deliverable', 'user',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Opaque provider signature|Hidden replay information/);
  });

  it('resumes visible reasoning from a compact reconnect baseline and settles it once', () => {
    const streams = newStreams();
    const baseline = { assistantStream: { activeAttempt: {
      attemptId: 'a', turn: 1, step: 1, stream: [
        { type: 'reasoning-chunks', texts: ['<signature>opaque', '</signature>\nReview'] },
      ],
    } } };
    let state = snapshotOf(baseline, streams);
    const send = (type: string, text: string) => {
      state = streamEventsOf({ type: 'chunk', attemptId: 'a', chunk: { type, text } }, streams).reduce(applyChange, state);
    };
    expect(rowsOf(state.items)).toMatchObject([{ kind: 'steps', status: 'running', entries: [{ text: 'Review' }] }]);
    send('reasoning-delta', ' the **test results**.');
    send('text-delta', 'I have the test results.');
    const committed = fixture.records.find(({ event }) => event.type === 'assistant/message')!.event;
    state = eventsOf(committed, state).reduce(applyChange, state);
    expect(state.items).toHaveLength(1);
    expect(rowsOf(state.items)).toMatchObject([
      { kind: 'steps', status: 'done', entries: [{ text: 'Review the **test results**.' }] },
      { kind: 'assistant', text: 'I have the test results.' },
    ]);
  });

  it('does not expose a partial signature or opaque provider fields in a live group', () => {
    const streams = newStreams();
    streamEventsOf({ type: 'start', attemptId: 'a', turn: 2, step: 1 }, streams);
    let state = EMPTY_SESSION;
    for (const fragment of ['<sign', 'ature>', 'opaque-material']) {
      state = streamEventsOf({ type: 'chunk', attemptId: 'a', chunk: { type: 'reasoning-delta', text: fragment } }, streams).reduce(applyChange, state);
      expect(rowsOf(state.items)).toEqual([]);
    }
  });
});
