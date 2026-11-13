// An admin revokes an invitation.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { revokeInvite } from '@/lib/team';

type Context = { params: Promise<{ teamId: string; id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, id } = await params;
    await revokeInvite(user.id, teamId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/teams/[teamId]/invites/[id]');
  }
}
