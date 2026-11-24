import { beforeEach, describe, expect, it } from 'vitest';

import {
  closeOtherTabs, closeTab, closeTabsToRight, emptySidebar, loadSidebar, moveTab, openTab, saveSidebar, selectTab, setOpen, setRatio, splitPane, type SidebarState,
} from './session-sidebar-state';

const file = (path: string, line?: number) => ({ kind: 'file' as const, path, line });
const kinds = (state: SidebarState) => state.panes.map((pane) => pane.tabs.map((tab) => (tab.kind === 'file' ? tab.path : tab.kind)));
const active = (state: SidebarState, pane = 0) => state.panes[pane]!.tabs.find((tab) => tab.id === state.panes[pane]!.active);

describe('the session sidebar', () => {
  it('starts collapsed and empty, and its first opening shows the start page', () => {
    const state = emptySidebar();
    expect(state.open).toBe(false);
    expect(kinds(setOpen(state, true))).toEqual([['start']]);
  });

  it('opens a file once: the same file again selects its tab, at the new line', () => {
    let state = openTab(emptySidebar(), file('a.ts'));
    state = openTab(state, file('b.ts'));
    state = openTab(state, file('a.ts', 42));
    expect(kinds(state)).toEqual([['a.ts', 'b.ts']]);
    expect(active(state)).toMatchObject({ path: 'a.ts', line: 42 });
  });

  it('glows a tab only when it was already in view', () => {
    let state = openTab(emptySidebar(), file('a.ts'));
    state = openTab(state, file('b.ts'));
    expect(openTab(state, file('a.ts')).flash).toBeUndefined();
    expect(openTab(state, file('b.ts')).flash?.tab).toBe(active(state)!.id);
  });

  it('opens a new tab after the active one, and replaces it when asked', () => {
    let state = openTab(emptySidebar(), file('a.ts'));
    state = openTab(state, file('c.ts'));
    state = openTab({ ...state, panes: [{ ...state.panes[0]!, active: state.panes[0]!.tabs[0]!.id }] }, file('b.ts'));
    expect(kinds(state)).toEqual([['a.ts', 'b.ts', 'c.ts']]);
    expect(kinds(openTab(state, file('d.ts'), { replace: true }))).toEqual([['a.ts', 'd.ts', 'c.ts']]);
  });

  it('closes to the right neighbour, and collapses with the last tab that is not the start page', () => {
    let state = setOpen(emptySidebar(), true);
    state = openTab(state, file('a.ts'));
    state = openTab(state, file('b.ts'));
    const [start, a, b] = state.panes[0]!.tabs;
    state = selectTab(state, a!.id);
    state = closeTab(state, a!.id);
    expect(active(state)?.id).toBe(b!.id);
    state = closeTab(state, b!.id);
    expect(state.open).toBe(false);
    expect(kinds(state)).toEqual([[]]);
    expect(kinds(setOpen(state, true))).toEqual([['start']]);
    expect(start!.kind).toBe('start');
  });

  it('closes the others and those to the right', () => {
    let state = emptySidebar();
    for (const path of ['a', 'b', 'c', 'd']) state = openTab(state, file(path));
    const b = state.panes[0]!.tabs[1]!.id;
    expect(kinds(closeTabsToRight(state, b))).toEqual([['a', 'b']]);
    expect(kinds(closeOtherTabs(state, b))).toEqual([['b']]);
  });

  it('splits into two panes at most, and an emptied pane goes', () => {
    let state = openTab(emptySidebar(), file('a.ts'));
    state = splitPane(state);
    expect(kinds(state)).toEqual([['a.ts'], ['start']]);
    expect(splitPane(state)).toBe(state);
    state = closeTab(state, state.panes[1]!.tabs[0]!.id);
    expect(kinds(state)).toEqual([['a.ts']]);
    expect(state.open).toBe(true);
  });

  it('moves a tab within its strip, across panes, and splits on a side drop', () => {
    let state = emptySidebar();
    for (const path of ['a', 'b', 'c']) state = openTab(state, file(path));
    const [a, , c] = state.panes[0]!.tabs;
    const pane = state.panes[0]!.id;
    expect(kinds(moveTab(state, a!.id, { pane, index: 3 }))).toEqual([['b', 'c', 'a']]);
    expect(kinds(moveTab(state, c!.id, { pane, index: 0 }))).toEqual([['c', 'a', 'b']]);
    const split = moveTab(state, c!.id, { pane, side: 'right' });
    expect(kinds(split)).toEqual([['a', 'b'], ['c']]);
    expect(kinds(moveTab(split, split.panes[1]!.tabs[0]!.id, { pane: split.panes[0]!.id, index: 0 }))).toEqual([['c', 'a', 'b']]);
  });

  it('keeps the split between 20% and 80%', () => {
    expect(setRatio(emptySidebar(), 0.05).ratio).toBe(0.2);
    expect(setRatio(emptySidebar(), 0.95).ratio).toBe(0.8);
  });
});

describe('the saved sidebar', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
  });

  it('comes back as it was left, per session', () => {
    const state = openTab(openTab(emptySidebar(), file('a.ts', 3)), { kind: 'files' });
    saveSidebar('c1.s1', state);
    const read = loadSidebar('c1.s1');
    expect(kinds(read)).toEqual([['a.ts', 'files']]);
    expect(read.open).toBe(true);
    expect(kinds(loadSidebar('c1.s2'))).toEqual([[]]);
  });

  it('drops what it cannot read', () => {
    localStorage.setItem('teamwork.sidebar.v1.x', JSON.stringify({ panes: [{ id: 'p', active: 't', tabs: [{ id: 't', kind: 'file' }, { id: 'u', kind: 'evil' }] }] }));
    expect(kinds(loadSidebar('x'))).toEqual([[]]);
    localStorage.setItem('teamwork.sidebar.v1.y', '{');
    expect(loadSidebar('y').open).toBe(false);
  });
});
