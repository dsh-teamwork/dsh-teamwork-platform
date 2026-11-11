// The caller's team, their role and its members; `no_team` when they are in none.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { teamOf, TeamError } from '@/lib/team';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const team = await teamOf(user.id);
    if (!team) throw new TeamError(403, 'no_team');
    return NextResponse.json(team);
  } catch (error) {
    return handleRouteError(error, 'GET /api/team');
  }
}
