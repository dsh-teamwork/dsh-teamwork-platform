import { describe, expect, it } from 'vitest';
import { defaultSessionView, orderedSessionGroups, readSessionView, visibleSessionGroups, workspaceRows, type SessionView } from '../session-view';
import type { SessionSummary } from '../types';

const session = (id: string, day: number, position: number, { archived = false, pinned = false, workspace = 'w' } = {}): SessionSummary => ({
  id, title: id, updatedAt: new Date(day * 86400000).toISOString(), directory: '', status: 'idle', step: null, pending: null,
  marks: { archived, pinned, workspace: workspace ? { id: workspace, title: workspace, index: workspace === 'w' ? 0 : 1, position } : null },
});
// DSH lists w as old, archive, recent, pin; v as late.
const list = [session('recent', 4, 2), session('old', 1, 0), session('archive', 3, 1, { archived: true }), session('pin', 1, 3, { pinned: true }), session('late', 9, 0, { workspace: 'v' })];
const ids = (view: Partial<SessionView>, open?: string) =>
  visibleSessionGroups(orderedSessionGroups(list, { ...defaultSessionView, ...view }), view.filter ?? 'hide', open).map((g) => g.sessions.map((s) => s.id));

describe('session view options', () => {
  it('keeps the desktop order by default, pinned sessions first', () => {
    expect(ids({})).toEqual([['pin', 'old', 'recent'], ['late']]);
  });
  it('orders by the latest change on request', () => {
    expect(ids({ sort: 'updated' })).toEqual([['pin', 'recent', 'old'], ['late']]);
    expect(ids({ sort: 'updated', grouping: 'flat' })).toEqual([['pin', 'late', 'recent', 'old']]);
  });
  it('lists every workspace in turn in one list', () => {
    expect(ids({ grouping: 'flat' })).toEqual([['pin', 'old', 'recent', 'late']]);
  });
  it('filters archived sessions but keeps the open one listed', () => {
    expect(ids({ filter: 'all' })).toEqual([['pin', 'old', 'archive', 'recent'], ['late']]);
    expect(ids({ filter: 'only' })).toEqual([['archive']]);
    expect(ids({}, 'archive')).toEqual([['pin', 'old', 'archive', 'recent'], ['late']]);
  });
  it('reads each saved option on its own', () => {
    expect(readSessionView(JSON.stringify({ grouping: 'flat', filter: 'only', sort: 'updated' }))).toEqual({ grouping: 'flat', filter: 'only', sort: 'updated' });
    expect(readSessionView(JSON.stringify({ grouping: 'flat', sort: 'manual' }))).toEqual({ ...defaultSessionView, grouping: 'flat' });
    expect(readSessionView('invalid')).toEqual(defaultSessionView);
    expect(readSessionView(null)).toEqual(defaultSessionView);
  });
  it('nests a workspace beneath its registered parents and folds the branch', () => {
    const child = session('child', 5, 0);
    child.marks!.workspace!.ancestors = [{ id: 'parent', title: 'Parent', index: 1 }];
    const groups = orderedSessionGroups([child], defaultSessionView);
    expect(workspaceRows(groups, 'workspaceTree', new Set()).map((g) => [g.workspace?.id, g.depth])).toEqual([['parent', 0], ['w', 1]]);
    expect(workspaceRows(groups, 'workspaceTree', new Set(['parent']))).toHaveLength(1);
    expect(workspaceRows(groups, 'workspace', new Set()).map((g) => [g.workspace?.id, g.depth])).toEqual([['w', 0]]);
  });
});
