import { t } from '../../lib/copy';
import {
  LayoutDashboard,
  Users,
  Settings,
  Building2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Path only — query params go in `query` so active-matching can see them. */
  href: string;
  label: string;
  icon: LucideIcon;
  /** Preset filters. An entry with a query is a saved view of its page. */
  query?: Record<string, string>;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The console's module map, grouped by operator intent rather than by table:
 * somebody arrives wanting to "see how things are" or "look up a customer",
 * and the group names that. Add a page to a group, never to a flat list.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: t('overview'),
    items: [{ href: '/', label: t('dashboard'), icon: LayoutDashboard }],
  },
  {
    label: t('customers'),
    items: [
      { href: '/users', label: t('users'), icon: Users },
      { href: '/teams', label: t('teams'), icon: Building2 },
      { href: '/system', label: t('system'), icon: Settings },
    ],
  },
];

/** The full href for a nav entry, including its preset filters. */
export function navHref(item: NavItem): string {
  if (!item.query) return item.href;
  return `${item.href}?${new URLSearchParams(item.query).toString()}`;
}

let ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
export function configureNavigation(extra: NavItem[]) {
  NAV_GROUPS[1].items.push(...extra);
  ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
}

/**
 * Which nav entry the current URL belongs to. Two rules keep exactly one row
 * lit: the longest path match wins (so a nested route does not also light its
 * parent, and `/` lights only on `/`), and an entry with preset filters beats
 * the bare entry for the same path when every one of its params is present.
 */
export function isNavItemActive(
  item: NavItem,
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const pathMatches = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`);
  if (!pathMatches(item.href)) return false;

  const deeperMatch = ALL_ITEMS.some(
    (other) =>
      other.href !== item.href &&
      other.href.startsWith(item.href === '/' ? '/' : `${item.href}/`) &&
      pathMatches(other.href),
  );
  if (deeperMatch) return false;

  const queryMatches = (query: Record<string, string> | undefined) =>
    Object.entries(query ?? {}).every(
      ([key, value]) => searchParams.get(key) === value,
    );
  if (item.query) return queryMatches(item.query);
  return !ALL_ITEMS.some(
    (other) =>
      other.href === item.href && other.query && queryMatches(other.query),
  );
}
