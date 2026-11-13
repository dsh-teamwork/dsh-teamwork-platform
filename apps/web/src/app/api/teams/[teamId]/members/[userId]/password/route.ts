// An admin gives a member a new first password, shown once.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { resetMemberPassword } from '@/lib/team';

type Context = { params: Promise<{ teamId: string; userId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, userId } = await params;
    return NextResponse.json(await resetMemberPassword(user.id, teamId, userId));
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams/[teamId]/members/[userId]/password');
  }
}
