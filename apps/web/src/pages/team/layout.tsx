/**
 * Every page of one team's console, inside its sidebar (ADR 0013: the team is
 * in the URL). The team and the person's other teams are read here, once per
 * team, and handed to the pages through `useTeam`; a page reads its own data.
 * A team the person is not in is not found, as one that does not exist.
 */

import { createContext, createElement, useContext } from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Loading, useTitle } from '@/components/page';
import { ConsoleShell } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { ApiError, type Schemas, type Team, type TeamSummary } from '@/lib/api';
import { editionTeamNotice } from '@/lib/edition';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface TeamState {
  team: Team;
  /** Reads the team again, after a write that changes its members. */
  reload: () => Promise<unknown>;
  /** The signed-in person's id. */
  me: string;
  /** The instance holds passwords: members get a first password, not an invitation. */
  passwords: boolean;
  /** For the team's admin, what waits on the team and its recent usage (`GET …/summary?scope=team`); absent until read, and for a member. */
  teamSummary?: Schemas['TeamSummary'];
  /** Reads the team's summary again, after a write that changes what waits. */
  reloadTeamSummary: () => Promise<unknown>;
}

const TeamContext = createContext<TeamState | null>(null);

export function useTeam(): TeamState {
  const state = useContext(TeamContext);
  if (!state) throw new Error('useTeam outside TeamLayout');
  return state;
}

export function TeamLayout() {
  const { teamId = '' } = useParams();
  const { session } = useSession();
  const tc = useTranslations('common');
  const tt = useTranslations('team');
  const word = useTeamError();
  const team = useApi<Team>(`teams/${encodeURIComponent(teamId)}`);
  // Only the sidebar needs every team, and it stays mounted while the team or the page beside it changes.
  const teams = useApi<TeamSummary[]>('teams');
  // Read beside the team, never in front of it: the sidebar's dots and the team overview wait for it, nothing
  // else does. Only an admin has one, so it is read once the team says whose console this is.
  const admin = team.data?.role === 'admin';
  const summary = useApi<Schemas['TeamSummary']>(admin ? `teams/${encodeURIComponent(teamId)}/summary?scope=team` : null);
  const Notice = editionTeamNotice();
  useTitle(team.data?.name);

  if (team.error instanceof ApiError && team.error.code === 'team_not_found') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <p className="text-5xl font-semibold">404</p>
        <p className="text-sm text-muted-foreground">{word(team.error)}</p>
        <Link to="/teams" className="text-sm text-muted-foreground underline underline-offset-4">
          {tt('switcher.all')}
        </Link>
      </main>
    );
  }
  const failed = (!team.data && team.error) || (!teams.data && teams.error);
  if (failed) {
    return (
      <CardPage title={tc('appName')} description={word(failed)}>
        <Button variant="outline" onClick={() => void Promise.all([team.reload(), teams.reload()])}>
          {tc('retry')}
        </Button>
      </CardPage>
    );
  }
  if (!team.data || !teams.data || !session.user) return <Loading />;

  return (
    <TeamContext.Provider
      value={{ team: team.data, reload: team.reload, me: session.user.id, passwords: session.doors.password, teamSummary: summary.data, reloadTeamSummary: summary.reload }}
    >
      <ConsoleShell team={team.data} teams={teams.data} waiting={waiting(summary.data)}>
        {Notice && createElement(Notice, { team: team.data })}
        <Outlet />
      </ConsoleShell>
    </TeamContext.Provider>
  );
}

/** Whether the team overview has items that need the administrator's attention. */
function waiting(summary?: Schemas['TeamSummary']) {
  if (!summary) return { overview: false };
  const any = summary.unpricedModels.length > 0 || summary.overruns > 0 || summary.nearLimit.length > 0 || summary.unresolved > 0 || summary.failedNotices > 0;
  return { overview: any };
}

/** `/teams/{teamId}` itself: an admin lands on the team overview, a member on the workspace's home (ADR 0049). */
export function TeamIndex() {
  const { team } = useTeam();
  return <Navigate to={`/teams/${encodeURIComponent(team.id)}/${team.role === 'admin' ? 'overview' : 'home'}`} replace />;
}

/** The admin's pages, Team management: a member who opens one is sent to the workspace's home (ADR 0043). */
export function AdminOnly() {
  const { team } = useTeam();
  return team.role === 'admin' ? <Outlet /> : <Navigate to={`/teams/${encodeURIComponent(team.id)}/home`} replace />;
}
