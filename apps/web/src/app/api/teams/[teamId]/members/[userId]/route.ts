// An admin removes a member.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { removeMember } from '@/lib/team';

type Context = { params: Promise<{ teamId: string; userId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, userId } = await params;
    await removeMember(user.id, teamId, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/teams/[teamId]/members/[userId]');
  }
}
