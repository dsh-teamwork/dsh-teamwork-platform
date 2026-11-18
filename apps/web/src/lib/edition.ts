/**
 * What an edition's web app adds to this one through `mountWeb` (src/app.tsx):
 * the team pages its console navigation lists beside the open ones. Set once,
 * before the first render.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

import type { Team } from '@/lib/api';
import type { Locale } from '@/lib/locale';

/** The console's navigation groups: Workspace for everyone, the other two for the team's admin alone. */
export type TeamGroup = 'work' | 'assets' | 'people';

export interface TeamPage {
  /**
   * Its route under a team, /teams/:teamId/{path}; an open page's path
   * replaces that page. The navigation links to the part before any `/:`
   * (`cloud/:sessionId?` is listed as `cloud`).
   */
  path: string;
  element: ReactNode;
  /** Its entry in the team navigation, in each language. */
  labels: Record<Locale, string>;
  icon: LucideIcon;
  /**
   * The navigation group it joins: Workspace, for every member, or one of the
   * admin's two under Team management, Team assets (what the team publishes)
   * and Members and spend (ADR 0043).
   */
  group: TeamGroup;
  /**
   * Whether the entry is listed in this team, for a page some teams have
   * (an edition's per-team switch); omitted, it is listed in every team. The
   * page itself still answers what its API allows: this is navigation only.
   */
  visible?: (team: Team) => Promise<boolean>;
  /**
   * Whether the page fills the whole area beside the sidebar (below the top
   * bar on a phone), edge to edge, full height and without the console's
   * padding, to lay out columns of its own (a list beside what is open in
   * it); omitted, it sits in the console's centred column like every open
   * page.
   */
  fill?: boolean;
}

/** The first segment a team page's navigation entry links to. */
export const navPath = (page: TeamPage) => page.path.split('/:')[0];

let teamPages: readonly TeamPage[] = [];

export const editionTeamPages = () => teamPages;

export function setEditionTeamPages(pages: readonly TeamPage[]) {
  teamPages = pages;
}

/** routes without any whose path one of added has, at every level, then added: how an edition replaces a page. */
export function replacing(routes: RouteObject[], added: RouteObject[]): RouteObject[] {
  const taken = new Set(added.map((r) => r.path).filter(Boolean));
  const keep = (list: RouteObject[]): RouteObject[] =>
    list.filter((r) => !r.path || !taken.has(r.path)).map((r) => (r.children ? ({ ...r, children: keep(r.children) } as RouteObject) : r));
  return [...keep(routes), ...added];
}
