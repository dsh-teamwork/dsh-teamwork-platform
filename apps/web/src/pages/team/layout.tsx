/**
 * Every page of one team's console, inside its sidebar (ADR 0013: the team is
 * in the URL). The team and the person's other teams are read here, once per
 * team, and handed to the pages through `useTeam`; a page reads its own data.
 * A team the person is not in is not found, as one that does not exist.
 */

import { createContext, useContext } from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Loading, useTitle } from '@/components/page';
import { ConsoleShell } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { ApiError, type Schemas, type Team, type TeamSummary } from '@/lib/api';
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
  /** What waits on the person, and recent usage (`GET …/summary`); absent until it is read. */
  summary?: Schemas['TeamSummary'];
  /** Reads the summary again, after a write that changes what waits. */
  reloadSummary: () => Promise<unknown>;
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
  // Read beside the team, never in front of it: the sidebar's dot and the overview wait for it, nothing else does.
  const summary = useApi<Schemas['TeamSummary']>(`teams/${encodeURIComponent(teamId)}/summary`);
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
      value={{ team: team.data, reload: team.reload, me: session.user.id, passwords: session.doors.password, summary: summary.data, reloadSummary: summary.reload }}
    >
      <ConsoleShell
        team={team.data}
        teams={teams.data}
        reviewsWaiting={team.data.role === 'admin' && (summary.data?.pendingReviews ?? 0) > 0}
      >
        <Outlet />
      </ConsoleShell>
    </TeamContext.Provider>
  );
}

/** The admin's pages, Team setup and Members and spend: a member who opens one is sent to the team's home (ADR 0043). */
export function AdminOnly() {
  const { team } = useTeam();
  return team.role === 'admin' ? <Outlet /> : <Navigate to={`/teams/${encodeURIComponent(team.id)}`} replace />;
}
