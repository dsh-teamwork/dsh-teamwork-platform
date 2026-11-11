// An admin lists the team's invitations, or makes a single-use one (its token is in this answer only).
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createInvite, listInvites } from '@/lib/team';

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listInvites((await requireUser(request)).id));
  } catch (error) {
    return handleRouteError(error, 'GET /api/team/invites');
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createInvite((await requireUser(request)).id), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/team/invites');
  }
}
