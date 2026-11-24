/**
 * How a member views one computer's sessions on the web and on the phone, with the options DSH's desktop sidebar
 * offers: which archived sessions show, how they group, and whether DSH's own order or the latest change orders them.
 * The order is always the computer's (`sessionGroups`); nothing here keeps an order of its own, so the desktop, the
 * console and the phone list a computer's sessions alike.
 */

import { sessionGroups, type SessionGroup } from './dsh';
import type { SessionSummary } from './types';

export const archiveFilters = ['hide', 'all', 'only'] as const;
export const sessionGroupings = ['workspace', 'workspaceTree', 'flat'] as const;
export const sessionSorts = ['desktop', 'updated'] as const;
export interface SessionView {
  grouping: typeof sessionGroupings[number];
  filter: typeof archiveFilters[number];
  sort: typeof sessionSorts[number];
}
export const defaultSessionView: SessionView = { grouping: 'workspace', filter: 'hide', sort: 'desktop' };

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? value as T : fallback;

/** A saved view, each option read on its own: an unknown or missing one falls back to its default. */
export function readSessionView(raw: string | null): SessionView {
  let saved: Partial<Record<keyof SessionView, unknown>> | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // An unreadable value is the default view.
  }
  return {
    grouping: oneOf(sessionGroupings, saved?.grouping, defaultSessionView.grouping),
    filter: oneOf(archiveFilters, saved?.filter, defaultSessionView.filter),
    sort: oneOf(sessionSorts, saved?.sort, defaultSessionView.sort),
  };
}

const pinned = (s: SessionSummary) => !!s.marks?.pinned && !s.marks.archived;
const pinnedFirst = (a: SessionSummary, b: SessionSummary) => Number(pinned(b)) - Number(pinned(a));
const newestFirst = (a: SessionSummary, b: SessionSummary) =>
  pinnedFirst(a, b) || b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : Number(a.id !== b.id));

/**
 * Every session, archived ones included, in the groups and order `view` asks for. `desktop` keeps DSH's own order
 * (`sessionGroups`); in one list that is each workspace's sessions in turn, then Ungrouped. Pinned sessions lead
 * either way.
 */
export function orderedSessionGroups(sessions: readonly SessionSummary[], view: SessionView): SessionGroup[] {
  const grouped = sessionGroups(sessions, true);
  const groups = view.grouping === 'flat'
    ? [{ workspace: null, sessions: grouped.flatMap((group) => group.sessions).sort(pinnedFirst) }]
    : grouped;
  return view.sort === 'updated' ? groups.map((group) => ({ ...group, sessions: [...group.sessions].sort(newestFirst) })) : groups;
}

export function matchesArchiveFilter(s: SessionSummary, filter: SessionView['filter']) {
  return filter === 'all' || Boolean(s.marks?.archived) === (filter === 'only');
}

/** The groups' sessions the archive filter shows, and `open` whatever the filter; a group left empty is dropped. */
export function visibleSessionGroups(groups: readonly SessionGroup[], filter: SessionView['filter'], open?: string) {
  return groups
    .map((group) => ({ ...group, sessions: group.sessions.filter((s) => s.id === open || matchesArchiveFilter(s, filter)) }))
    .filter((group) => group.sessions.length > 0);
}

/**
 * The groups as rows, each with its depth. In a workspace tree a workspace sits under the registered parent folders
 * its plugin names (`SessionWorkspace.ancestors`), a parent with no session of its own showing as an empty row, and a
 * folded workspace hides its whole branch; otherwise every group is a row at depth 0.
 */
export function workspaceRows(groups: readonly SessionGroup[], grouping: SessionView['grouping'], folded: ReadonlySet<string>) {
  if (grouping !== 'workspaceTree') return groups.map((group) => ({ ...group, depth: 0 }));
  type Node = { group: SessionGroup; index: number; children: Map<string, Node> };
  const roots = new Map<string, Node>();
  const loose = groups.filter((group) => !group.workspace);
  for (const group of groups) {
    const workspace = group.sessions[0]?.marks?.workspace;
    if (!workspace) continue;
    let level = roots;
    for (const entry of [...workspace.ancestors ?? [], workspace]) {
      let node = level.get(entry.id);
      if (!node) {
        node = { group: { workspace: { id: entry.id, title: entry.title }, sessions: [] }, index: entry.index, children: new Map() };
        level.set(entry.id, node);
      }
      if (entry === workspace) node.group = group;
      level = node.children;
    }
  }
  const rows: (SessionGroup & { depth: number })[] = [];
  function visit(level: Map<string, Node>, depth: number) {
    for (const node of [...level.values()].sort((a, b) => a.index - b.index)) {
      rows.push({ ...node.group, depth });
      if (!folded.has(node.group.workspace!.id)) visit(node.children, depth + 1);
    }
  }
  visit(roots, 0);
  return rows.concat(loose.map((group) => ({ ...group, depth: 0 })));
}
