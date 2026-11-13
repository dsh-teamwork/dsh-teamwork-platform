// A member leaves the team.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { leaveTeam } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    await leaveTeam((await requireUser(request)).id, (await params).teamId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/teams/[teamId]/membership');
  }
}
