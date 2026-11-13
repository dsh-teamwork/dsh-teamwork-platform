// An admin lists the team's invitations or creates one.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createInvite, listInvites } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await listInvites(user.id, (await params).teamId));
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams/[teamId]/invites');
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createInvite(user.id, (await params).teamId), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams/[teamId]/invites');
  }
}
