import { describe, expect, it } from 'vitest';
import { defaultSessionView, moveSession, orderedSessionGroups, readSessionView, syncManualOrder, visibleSessionGroups, workspaceRows } from '../session-view';
import type { SessionSummary } from '../types';

const session = (id: string, day: number, archived = false, pinned = false): SessionSummary => ({
  id, title: id, updatedAt: new Date(day * 86400000).toISOString(), directory: '', status: 'idle', step: null, pending: null,
  marks: { archived, pinned, workspace: { id: 'w', title: 'Work', index: 0, position: 0 } },
});
const list = [session('old', 1), session('recent', 4), session('archive', 3, true), session('pin', 1, false, true)];
const groups = orderedSessionGroups(list, defaultSessionView);
const ids = (filter: 'hide' | 'all' | 'only') => visibleSessionGroups(groups, filter)[0]?.sessions.map((s) => s.id);

describe('native session view options', () => {
  it('filters archives and keeps pins ahead of recent updates', () => {
    expect(ids('hide')).toEqual(['pin', 'recent', 'old']);
    expect(ids('all')).toEqual(['pin', 'recent', 'archive', 'old']);
    expect(ids('only')).toEqual(['archive']);
  });
  it('retains hidden members and restores manual order after a new member arrives', () => {
    const manual = moveSession(defaultSessionView, groups, 'old', 'recent');
    const added = [...list, session('new', 8)];
    const saved = syncManualOrder(manual, orderedSessionGroups(added, manual));
    const restored = readSessionView(JSON.stringify(saved));
    expect(orderedSessionGroups(added, restored)[0]!.sessions.map((s) => s.id)).toEqual(['pin', 'old', 'recent', 'archive', 'new']);
    expect(moveSession(restored, groups, 'pin', 'recent')).toBe(restored);
    expect(readSessionView('invalid')).toEqual(defaultSessionView);
  });
  it('nests matching workspaces beneath their registered parents and folds descendants', () => {
    const child = session('child', 5);
    child.marks!.workspace!.ancestors = [{ id: 'parent', title: 'Parent', index: 1 }];
    const groups = orderedSessionGroups([child], defaultSessionView);
    expect(workspaceRows(groups, 'workspaceTree', new Set()).map((g) => [g.workspace?.id, g.depth])).toEqual([['parent', 0], ['w', 1]]);
    expect(workspaceRows(groups, 'workspaceTree', new Set(['parent']))).toHaveLength(1);
  });
  it('keeps a flat manual order separate from the workspace order and reads older preferences', () => {
    const manual = moveSession(defaultSessionView, groups, 'old', 'recent');
    const flat = { ...manual, grouping: 'flat' as const };
    const reordered = moveSession(flat, orderedSessionGroups(list, flat), 'archive', 'recent');
    expect(orderedSessionGroups(list, reordered)[0]?.sessions.map((s) => s.id)).toEqual(['pin','archive','recent','old']);
    expect(reordered.orders['group:w']).toEqual(manual.orders['group:w']);
    expect(readSessionView(JSON.stringify({ ...reordered, grouping: undefined })).grouping).toBe('workspace');
  });

});
