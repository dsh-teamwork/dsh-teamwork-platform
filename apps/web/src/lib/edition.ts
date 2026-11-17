/**
 * What an edition's web app adds to this one through `mountWeb` (src/app.tsx):
 * the team pages its console navigation lists beside the open ones. Set once,
 * before the first render.
 */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

import type { Locale } from '@/lib/locale';

export interface TeamPage {
  /** Its path under a team, /teams/:teamId/{path}; an open page's path replaces that page. */
  path: string;
  element: ReactNode;
  /** Its entry in the team navigation, under governance, in each language. */
  labels: Record<Locale, string>;
  icon: LucideIcon;
}

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
