/**
 * What a session's right sidebar holds, as DSH's own (`ui-sidebar-right` and `ui-dockkit` in DeepSeek Harness): one or
 * two panes of tabs side by side, which tab each shows, the split between them, whether the column is open and whether
 * it fills the window. Pure, so every rule is a function of the state; the screen is `session-sidebar.tsx`. It is kept
 * per session in this browser (`loadSidebar`), as DSH keeps it per session.
 */

import type { PublishedArtifact } from '@dsh-teamwork/relay-client';

/** The start page (DSH's guide), the workspace's files, one file at `line`, or an artifact the agent published. */
export type TabContent =
  | { kind: 'start' }
  | { kind: 'files' }
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'artifact'; artifact: PublishedArtifact };

export type Tab = TabContent & { id: string };

export interface Pane {
  id: string;
  tabs: Tab[];
  active: string;
}

export interface SidebarState {
  open: boolean;
  fullscreen: boolean;
  /** One pane, or two side by side. */
  panes: Pane[];
  /** The pane a new tab goes into. */
  focused: string;
  /** The first pane's share of the width when there are two, 0.2 to 0.8. */
  ratio: number;
  /** A tab revealed while already open, which glows once; `at` restarts the glow. */
  flash?: { tab: string; at: number };
}

/** DSH's product limit: two panes side by side. */
export const MAX_PANES = 2;
const MIN_RATIO = 0.2;

let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A collapsed, empty sidebar: a session starts so, and its first opening shows the start page. */
export function emptySidebar(): SidebarState {
  const pane = { id: newId('p'), tabs: [], active: '' };
  return { open: false, fullscreen: false, panes: [pane], focused: pane.id, ratio: 0.5 };
}

/** What a tab shows, for telling one tab from another: the same file at another line is the same tab. */
function identity(content: TabContent): string {
  switch (content.kind) {
    case 'file': return `file:${content.path}`;
    case 'artifact': return `artifact:${content.artifact.teamId}:${content.artifact.artifactId}`;
    default: return content.kind;
  }
}

function findTab(state: SidebarState, tabId: string): { pane: Pane; index: number } | null {
  for (const pane of state.panes) {
    const index = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (index >= 0) return { pane, index };
  }
  return null;
}

function withPane(state: SidebarState, paneId: string, change: (pane: Pane) => Pane): SidebarState {
  return { ...state, panes: state.panes.map((pane) => (pane.id === paneId ? change(pane) : pane)) };
}

/** The focused pane, or the first when it is gone. */
function focusedPane(state: SidebarState): Pane {
  return state.panes.find((pane) => pane.id === state.focused) ?? state.panes[0]!;
}

/**
 * Shows `content`: a tab already open with the same file or page is selected wherever it is, takes the new line and
 * glows once; anything else opens as a new tab after the active one in the focused pane. The column opens. `replace`
 * puts it in place of the focused pane's active tab instead (a file picked from that tab's navigator).
 */
export function openTab(state: SidebarState, content: TabContent, options: { replace?: boolean; pane?: string } = {}): SidebarState {
  const key = identity(content);
  for (const pane of state.panes) {
    const found = pane.tabs.find((tab) => identity(tab) === key);
    if (!found) continue;
    const next = withPane(state, pane.id, (p) => ({ ...p, active: found.id, tabs: p.tabs.map((tab) => (tab.id === found.id ? { ...content, id: tab.id } : tab)) }));
    // Only a tab already in view glows: one brought forward is its own signal.
    const visible = state.open && pane.active === found.id;
    return { ...next, open: true, focused: pane.id, flash: visible ? { tab: found.id, at: Date.now() } : state.flash };
  }
  const target = state.panes.find((pane) => pane.id === options.pane) ?? focusedPane(state);
  const tab = { ...content, id: newId('t') } as Tab;
  return {
    ...withPane(state, target.id, (pane) => {
      const at = pane.tabs.findIndex((t) => t.id === pane.active);
      if (options.replace && at >= 0) return { ...pane, active: tab.id, tabs: pane.tabs.map((t, i) => (i === at ? tab : t)) };
      const tabs = [...pane.tabs];
      tabs.splice(at + 1, 0, tab);
      return { ...pane, tabs, active: tab.id };
    }),
    open: true,
    focused: target.id,
  };
}

/**
 * Opens or closes the column. Opening an empty one seeds it with the start page, as DSH's first expand does; closing
 * keeps every tab, so the next opening finds them.
 */
export function setOpen(state: SidebarState, open: boolean): SidebarState {
  if (!open) return { ...state, open: false };
  const pane = focusedPane(state);
  if (state.panes.every((p) => p.tabs.length === 0)) return openTab(state, { kind: 'start' }, { pane: pane.id });
  return { ...state, open: true };
}

export function selectTab(state: SidebarState, tabId: string): SidebarState {
  const found = findTab(state, tabId);
  if (!found) return state;
  return { ...withPane(state, found.pane.id, (pane) => ({ ...pane, active: tabId })), focused: found.pane.id };
}

/** Removes empty panes but the last, keeping focus on a pane that still exists. */
function settle(state: SidebarState): SidebarState {
  const panes = state.panes.filter((pane) => pane.tabs.length > 0);
  if (panes.length === 0) {
    // DSH collapses the column with its last tab: the pane stays, empty, for the next opening's start page.
    const pane = { ...state.panes[0]!, tabs: [], active: '' };
    return { ...state, panes: [pane], focused: pane.id, open: false, fullscreen: false };
  }
  const focused = panes.some((pane) => pane.id === state.focused) ? state.focused : panes[0]!.id;
  return { ...state, panes, focused };
}

/** The tab a pane shows after `closing` leaves it: its right neighbour, else its left one. */
function neighbour(pane: Pane, closing: ReadonlySet<string>): string {
  if (!closing.has(pane.active)) return pane.active;
  const index = pane.tabs.findIndex((tab) => tab.id === pane.active);
  const after = pane.tabs.slice(index + 1).find((tab) => !closing.has(tab.id));
  const before = pane.tabs.slice(0, index).reverse().find((tab) => !closing.has(tab.id));
  return (after ?? before)?.id ?? '';
}

function closeSet(state: SidebarState, paneId: string, closing: ReadonlySet<string>): SidebarState {
  const next = withPane(state, paneId, (pane) => ({ ...pane, active: neighbour(pane, closing), tabs: pane.tabs.filter((tab) => !closing.has(tab.id)) }));
  // Closing the last tab that is not the start page collapses the column, as in DSH.
  const left = next.panes.flatMap((pane) => pane.tabs);
  const closedContent = state.panes.some((pane) => pane.tabs.some((tab) => closing.has(tab.id) && tab.kind !== 'start'));
  if (closedContent && left.every((tab) => tab.kind === 'start')) {
    return settle({ ...next, panes: next.panes.map((pane) => ({ ...pane, tabs: [], active: '' })) });
  }
  return settle(next);
}

export function closeTab(state: SidebarState, tabId: string): SidebarState {
  const found = findTab(state, tabId);
  return found ? closeSet(state, found.pane.id, new Set([tabId])) : state;
}

export function closeOtherTabs(state: SidebarState, tabId: string): SidebarState {
  const found = findTab(state, tabId);
  if (!found) return state;
  const closing = new Set(found.pane.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  return selectTab(closeSet(state, found.pane.id, closing), tabId);
}

export function closeTabsToRight(state: SidebarState, tabId: string): SidebarState {
  const found = findTab(state, tabId);
  if (!found) return state;
  return closeSet(state, found.pane.id, new Set(found.pane.tabs.slice(found.index + 1).map((tab) => tab.id)));
}

/** Splits the column in two, the new pane on the right with the start page. Nothing happens at the limit. */
export function splitPane(state: SidebarState): SidebarState {
  if (state.panes.length >= MAX_PANES) return state;
  const pane: Pane = { id: newId('p'), tabs: [], active: '' };
  return openTab({ ...state, panes: [...state.panes, pane], ratio: 0.5 }, { kind: 'start' }, { pane: pane.id });
}

/**
 * Moves a tab, by dragging it: into a pane's strip at `index`, or onto one side of a pane's body (`side`), which splits
 * the column there when there is room for another pane, and otherwise moves the tab into the pane on that side.
 */
export function moveTab(state: SidebarState, tabId: string, to: { pane: string; index?: number; side?: 'left' | 'right' }): SidebarState {
  const found = findTab(state, tabId);
  if (!found) return state;
  const tab = found.pane.tabs[found.index]!;
  if (to.side && state.panes.length < MAX_PANES) {
    // A pane's own last tab cannot split it into itself and nothing.
    if (found.pane.tabs.length === 1) return state;
    const pane: Pane = { id: newId('p'), tabs: [tab], active: tab.id };
    const without = withPane(state, found.pane.id, (p) => ({ ...p, active: neighbour(p, new Set([tabId])), tabs: p.tabs.filter((t) => t.id !== tabId) }));
    const at = without.panes.findIndex((p) => p.id === to.pane);
    const panes = [...without.panes];
    panes.splice(to.side === 'left' ? at : at + 1, 0, pane);
    return settle({ ...without, panes, focused: pane.id, ratio: 0.5 });
  }
  const target = to.side ? (to.side === 'left' ? state.panes[0]! : state.panes[state.panes.length - 1]!) : state.panes.find((p) => p.id === to.pane);
  if (!target) return state;
  const removed = withPane(state, found.pane.id, (p) => ({
    ...p,
    active: p.id === target.id ? p.active : neighbour(p, new Set([tabId])),
    tabs: p.tabs.filter((t) => t.id !== tabId),
  }));
  const next = withPane(removed, target.id, (p) => {
    let index = to.index ?? p.tabs.length;
    // Within its own strip, the indexes after the tab's old place moved left by one.
    if (found.pane.id === target.id && index > found.index) index--;
    const tabs = [...p.tabs];
    tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
    return { ...p, tabs, active: tab.id };
  });
  return settle({ ...next, focused: target.id });
}

export function setRatio(state: SidebarState, ratio: number): SidebarState {
  return { ...state, ratio: Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)) };
}

export function setFullscreen(state: SidebarState, fullscreen: boolean): SidebarState {
  return { ...state, fullscreen };
}

const KEY = 'teamwork.sidebar.v1';

/** A session's sidebar as this browser last left it, or an empty one. Anything unreadable is dropped, not trusted. */
export function loadSidebar(scope: string): SidebarState {
  try {
    const raw = localStorage.getItem(`${KEY}.${scope}`);
    if (!raw) return emptySidebar();
    const read = JSON.parse(raw) as SidebarState;
    const panes = (Array.isArray(read.panes) ? read.panes : []).slice(0, MAX_PANES).map((pane) => {
      const tabs = (Array.isArray(pane.tabs) ? pane.tabs : []).filter(validTab);
      return { id: String(pane.id), tabs, active: tabs.some((tab) => tab.id === pane.active) ? pane.active : tabs[0]?.id ?? '' };
    }).filter((pane) => pane.tabs.length > 0);
    if (panes.length === 0) return emptySidebar();
    return {
      open: read.open === true,
      fullscreen: read.fullscreen === true,
      panes,
      focused: panes.some((pane) => pane.id === read.focused) ? read.focused : panes[0]!.id,
      ratio: typeof read.ratio === 'number' ? Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, read.ratio)) : 0.5,
    };
  } catch {
    return emptySidebar();
  }
}

function validTab(tab: unknown): tab is Tab {
  if (!tab || typeof tab !== 'object') return false;
  const value = tab as Partial<Tab> & Record<string, unknown>;
  if (typeof value.id !== 'string') return false;
  switch (value.kind) {
    case 'start':
    case 'files': return true;
    case 'file': return typeof value.path === 'string' && (value.line === undefined || typeof value.line === 'number');
    case 'artifact': return !!value.artifact && typeof (value.artifact as PublishedArtifact).artifactId === 'string' && typeof (value.artifact as PublishedArtifact).teamId === 'string';
    default: return false;
  }
}

export function saveSidebar(scope: string, state: SidebarState) {
  try {
    const { flash: _, ...kept } = state;
    localStorage.setItem(`${KEY}.${scope}`, JSON.stringify(kept));
  } catch {
    // Storage refused: the sidebar lasts for this page only.
  }
}
