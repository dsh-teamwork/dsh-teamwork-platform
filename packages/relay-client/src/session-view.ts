import { sessionGroups, type SessionGroup } from './dsh';
import type { SessionSummary } from './types';

export const archiveFilters = ['hide', 'all', 'only'] as const;
export const sessionGroupings = ['workspace', 'workspaceTree', 'flat'] as const;
export const sessionSorts = ['manual', 'updated'] as const;
export interface SessionView {
  grouping: typeof sessionGroupings[number];
  filter: typeof archiveFilters[number];
  sort: typeof sessionSorts[number];
  /** The local manual order within each workspace, including currently hidden sessions. */
  orders: Record<string, string[]>;
}
export const defaultSessionView: SessionView = { grouping: 'workspace', filter: 'hide', sort: 'updated', orders: {} };

export function readSessionView(raw: string | null): SessionView {
  if (!raw) return defaultSessionView;
  try {
    const saved = JSON.parse(raw);
    if (!archiveFilters.includes(saved?.filter) || !sessionSorts.includes(saved?.sort)) return defaultSessionView;
    const orders = Object.fromEntries(Object.entries(saved.orders ?? {}).filter(([key, ids]) =>
      (key === 'flat' || key.startsWith('group:')) && Array.isArray(ids) && ids.every((id) => typeof id === 'string')));
    return { grouping: sessionGroupings.includes(saved.grouping) ? saved.grouping : 'workspace', filter: saved.filter, sort: saved.sort, orders: orders as Record<string, string[]> };
  } catch {
    return defaultSessionView;
  }
}

type ViewGroup = SessionGroup & { flat?: boolean };
const groupKey = (group: ViewGroup) => group.flat ? 'flat' : 'group:' + (group.workspace?.id ?? '');
const pinned = (s: SessionSummary) => !!s.marks?.pinned && !s.marks.archived;

export function matchesArchiveFilter(s: SessionSummary, filter: SessionView['filter']) {
  return filter === 'all' || Boolean(s.marks?.archived) === (filter === 'only');
}

/** Derive the full order before searching or filtering so moving a visible row preserves hidden rows. */
export function orderedSessionGroups(sessions: readonly SessionSummary[], view: SessionView): ViewGroup[] {
  const groups: ViewGroup[] = view.grouping === 'flat'
    ? [{ workspace: null, sessions: [...sessions], flat: true }]
    : sessionGroups(sessions, true);
  return groups.map((group) => {
    const saved = view.sort === 'manual' ? view.orders[groupKey(group)] ?? [] : [];
    const rank = new Map(saved.map((id, i) => [id, i]));
    group.sessions.sort((a, b) => {
      if (pinned(a) !== pinned(b)) return Number(pinned(b)) - Number(pinned(a));
      const left = rank.get(a.id), right = rank.get(b.id);
      if (left !== right) return (left ?? Infinity) - (right ?? Infinity);
      if (view.sort === 'manual' && !!a.marks?.archived !== !!b.marks?.archived)
        return Number(!!a.marks?.archived) - Number(!!b.marks?.archived);
      return b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : Number(a.id !== b.id));
    });
    return group;
  });
}

export function rememberSessionOrder(groups: readonly SessionGroup[]) {
  return Object.fromEntries(groups.map((group) => [groupKey(group), group.sessions.map((s) => s.id)]));
}

/** Move within the same workspace and pin partition, starting manual mode from the current order. */
export function moveSession(view: SessionView, groups: readonly SessionGroup[], id: string, target: string): SessionView {
  for (const group of groups) {
    const from = group.sessions.findIndex((s) => s.id === id);
    const to = group.sessions.findIndex((s) => s.id === target);
    if (from < 0 || to < 0 || from === to || pinned(group.sessions[from]!) !== pinned(group.sessions[to]!)) continue;
    const orders = { ...view.orders, ...rememberSessionOrder(groups) };
    const order = orders[groupKey(group)]!;
    order.splice(from, 1);
    order.splice(to, 0, id);
    return { ...view, sort: 'manual', orders };
  }
  return view;
}

export function moveNeighbours(visible: readonly SessionSummary[], index: number) {
  const current = visible[index]!;
  const neighbour = (s?: SessionSummary) => s && pinned(s) === pinned(current) ? s.id : undefined;
  return { up: neighbour(visible[index - 1]), down: neighbour(visible[index + 1]) };
}

export function visibleSessionGroups(groups: SessionGroup[], filter: SessionView['filter'], query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return groups.map((group) => ({
    ...group,
    sessions: group.sessions.filter((s) => matchesArchiveFilter(s, filter) && (!needle ||
      [s.title, s.directory, s.marks?.workspace?.title].some((value) => value?.toLocaleLowerCase().includes(needle)))),
  })).filter((group) => group.sessions.length > 0);
}

/** Freeze newly listed sessions when using manual order, even before the user moves another row. */
export function syncManualOrder(view: SessionView, groups: SessionGroup[]) {
  if (view.sort !== 'manual') return view;
  const orders = { ...view.orders, ...rememberSessionOrder(groups) };
  return JSON.stringify(orders) === JSON.stringify(view.orders) ? view : { ...view, orders };
}

/** Insert registered ancestors even when only a descendant matches the filter, and fold entire branches. */
export function workspaceRows(groups: SessionGroup[], grouping: SessionView['grouping'], folded: ReadonlySet<string>) {
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
