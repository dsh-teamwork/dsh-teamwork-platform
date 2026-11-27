/**
 * What an edition's web app adds to this one through `mountWeb` (src/app.tsx):
 * the team pages its console navigation lists beside the open ones, the
 * models it supplies itself, and its community. Set once, before the first render.
 */

import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
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
  /**
   * What folds out under its entry in the navigation: the computers the page is reached on, each a `SubnavLink`
   * (components/team/console-shell.tsx) opening its sessions. Mounted only while unfolded, so it reads what it lists
   * only while that is shown.
   */
  subnav?: ComponentType<SubnavProps>;
}

/**
 * What a `TeamPage.subnav` is given: the team; while its page is open, the segment after its path ("" with none),
 * which names the computer open on it, and null while another page is; and what closes the narrow screen's navigation.
 */
export interface SubnavProps {
  teamId: string;
  current: string | null;
  onNavigate?: () => void;
}

/** The first segment a team page's navigation entry links to. */
export const navPath = (page: TeamPage) => page.path.split('/:')[0];

let teamPages: readonly TeamPage[] = [];

export const editionTeamPages = () => teamPages;

export function setEditionTeamPages(pages: readonly TeamPage[]) {
  teamPages = pages;
}

export type EditionTeamsNotice = ComponentType;
export type EditionTeamNotice = ComponentType<{ team: Team }>;

let teamsNotice: EditionTeamsNotice | undefined;
let teamNotice: EditionTeamNotice | undefined;

export const editionTeamsNotice = () => teamsNotice;
export const editionTeamNotice = () => teamNotice;

export function setEditionTeamsNotice(value: EditionTeamsNotice | undefined) {
  teamsNotice = value;
}

export function setEditionTeamNotice(value: EditionTeamNotice | undefined) {
  teamNotice = value;
}

/** routes without any whose path one of added has, at every level, then added: how an edition replaces a page. */
export function replacing(routes: RouteObject[], added: RouteObject[]): RouteObject[] {
  const taken = new Set(added.map((r) => r.path).filter(Boolean));
  const keep = (list: RouteObject[]): RouteObject[] =>
    list.filter((r) => !r.path || !taken.has(r.path)).map((r) => (r.children ? ({ ...r, children: keep(r.children) } as RouteObject) : r));
  return [...keep(routes), ...added];
}

/**
 * Models an edition supplies and funds itself, which a team admin turns on
 * without a provider or a key: an action in the team's models page header,
 * beside "BYOK model service", which opens the edition's own list. `reload`
 * refreshes the page once it has published one; it mounts again whenever the
 * team's models change. The open edition has none.
 */
export type EditionModels = ComponentType<{ teamId: string; reload: () => Promise<unknown> }>;

let models: EditionModels | undefined;

export const editionModels = () => models;

export function setEditionModels(section: EditionModels | undefined) {
  models = section;
}

/**
 * Where the people using an edition talk with the people making it, in one
 * language: a link, and the code a phone scans where joining is done in a
 * phone's chat app. The home page's foot and the console's carry it
 * (components/community.tsx, src/public/home.tsx); the open edition has none,
 * and then nothing is shown.
 */
export interface EditionCommunity {
  /** Its name, as the link reads ("Discord"). */
  label: string;
  href: string;
  /** The code to scan, an image URL, and the line beneath it; with one, the link opens it rather than leaving the page. */
  qr?: { src: string; caption: string };
}

let community: ((locale: Locale) => EditionCommunity) | undefined;

export const editionCommunity = (locale: Locale) => community?.(locale);

export function setEditionCommunity(value: ((locale: Locale) => EditionCommunity) | undefined) {
  community = value;
}

export interface EditionSecurity {
  account: ComponentType;
  authorizeApp(challenge: string): Promise<void>;
}

let security: EditionSecurity | undefined;
export const editionSecurity = () => security;
export function setEditionSecurity(value: EditionSecurity | undefined) { security = value; }
