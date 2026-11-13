// A team the caller is in, their role and its members; 404 for any other team.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { teamOf } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await teamOf(user.id, (await params).teamId));
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams/[teamId]');
  }
}
