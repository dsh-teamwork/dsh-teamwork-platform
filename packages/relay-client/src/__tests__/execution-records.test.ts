import { describe, expect, it } from 'vitest';

import { rowsOf, visibleConversationRows } from '../conversation';
import { applyChange, eventsOf, snapshotOf } from '../dsh';
import { applySessionEvent, EMPTY_SESSION } from '../session';
import fixture from './fixtures/execution-records.json';

describe('execution records', () => {
  it('projects the same details on a live follow and on replay, preserving replies between groups', () => {
    const live = fixture.records.reduce((state, { event }) => eventsOf(event, state).reduce(applyChange, state), EMPTY_SESSION);
    const replay = snapshotOf(fixture);
    expect(live).toEqual(replay);
    const rows = rowsOf(live.items);
    expect(rows.map((row) => row.kind)).toEqual(['user', 'work', 'steps', 'assistant', 'steps', 'assistant', 'user', 'steps', 'failed']);
    expect(rows[1]).toMatchObject({ kind: 'work', id: 'work-1', count: 4 });
    expect(rows[2]).toMatchObject({ status: 'failed', workId: 'work-1', entries: [
      { id: 'read', file: { path: 'src/check notes.ts', line: 120 }, status: 'done' },
      { id: 'test', status: 'failed', detail: { exitCode: 2, truncated: true, output: expect.stringContaining('Sample test output') } },
    ] });
    expect(rows[4]).toMatchObject({ status: 'denied', workId: 'work-1', entries: [
      { id: 'write', file: { path: 'report.md' }, status: 'done' },
      { id: 'declined', status: 'denied', detail: { output: 'Error: the user rejected tool "bash"' } },
    ] });
    expect(visibleConversationRows(rows, () => false).map((row) => row.kind)).toEqual(['user', 'work', 'assistant', 'assistant', 'user', 'steps', 'failed']);
    expect(visibleConversationRows(rows, (id) => id === 'work-1')).toEqual(rows);
  });

  it('joins a result back to its call when the reader loads the preceding page', () => {
    const older = snapshotOf({ records: fixture.records.slice(0, 5) });
    const newer = snapshotOf({ records: fixture.records.slice(5) });
    const merged = applySessionEvent(newer, { type: 'older', items: older.items, earlier: null });
    expect(rowsOf(merged.items)).toEqual(rowsOf(snapshotOf(fixture).items));
  });

  it('keeps live, stopped and interleaved turns out of the whole-turn fold', () => {
    const process = fixture.records.slice(0, 5);
    const steering = { event: { type: 'user/message', seq: 30, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Steer' }] } } };
    const end = (kind: string) => ({ event: { type: 'turn/end', seq: 31, data: { turn: 1, reason: { kind } } } });
    for (const records of [process, [...process, end('aborted')], [...process, steering, end('completed')]]) {
      expect(rowsOf(snapshotOf({ records }).items).some((row) => row.kind === 'work')).toBe(false);
    }
    expect(rowsOf(snapshotOf({ records: [...process, end('aborted')] }).items)[1]).toMatchObject({
      entries: [{ id: 'read' }, { id: 'test', status: 'stopped' }],
    });
  });

  it('bounds command output without losing the exit marker or splitting Unicode', () => {
    const records = structuredClone(fixture.records);
    const event = records.find(({ event }) => event.data.message?.toolCallId === 'test')!.event;
    event.data.message!.content = [{ type: 'text', text: 'x'.repeat(4095) + '\u{1F433}rest\n[exit code: 17]' }];
    const command = snapshotOf({ records }).items.find((item) => item.id === 'test');
    expect(command).toMatchObject({ status: 'failed', detail: { output: 'x'.repeat(4095), exitCode: 17, truncated: true } });
  });
});
