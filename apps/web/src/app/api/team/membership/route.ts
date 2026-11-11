// A member leaves their team.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { leaveTeam } from '@/lib/team';

export async function DELETE(request: Request) {
  try {
    await leaveTeam((await requireUser(request)).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/team/membership');
  }
}
