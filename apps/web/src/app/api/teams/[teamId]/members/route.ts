// An admin adds someone by email, where the instance holds passwords.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { addMember } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await addMember(user.id, (await params).teamId, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams/[teamId]/members');
  }
}
