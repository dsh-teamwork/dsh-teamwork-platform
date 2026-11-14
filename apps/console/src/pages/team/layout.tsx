/**
 * Every page of one team's console, inside its sidebar (ADR 0013: the team is
 * in the URL). The team and the person's other teams are read here, once per
 * team, and handed to the pages through `useTeam`; a page reads its own data.
 * A team the person is not in is not found, as one that does not exist.
 */

import { createContext, useContext } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Loading, useTitle } from '@/components/page';
import { ConsoleShell } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { ApiError, type Team, type TeamSummary } from '@/lib/api';
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
    <TeamContext.Provider value={{ team: team.data, reload: team.reload, me: session.user.id, passwords: session.doors.password }}>
      <ConsoleShell team={team.data} teams={teams.data} email={session.user.email ?? ''} passwords={session.doors.password}>
        <Outlet />
      </ConsoleShell>
    </TeamContext.Provider>
  );
}
