/**
 * What every page of a team's console needs before it renders: the signed-in
 * person, past any forced password change, and the team the URL names, which
 * they must be in (a team they are not in is a 404, as one that does not
 * exist). `cache` reads it once per request, however many of the layout and
 * page components ask.
 */

import 'server-only';

import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';
import { TeamError, teamOf } from '@/lib/team';

export const consolePage = cache(async (teamId: string) => {
  const here = `/teams/${teamId}`;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  if (strategy.passwords && (await mustChangePassword(user.id))) redirect(`/password?next=${encodeURIComponent(here)}`);
  try {
    const team = await teamOf(user.id, teamId);
    return { user, team, admin: team.role === 'admin' };
  } catch (error) {
    if (error instanceof TeamError && error.code === 'team_not_found') notFound();
    throw error;
  }
});
