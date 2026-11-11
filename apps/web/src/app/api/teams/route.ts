// Create a team; the caller becomes its admin.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createTeam } from '@/lib/team';

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createTeam(user.id, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams');
  }
}
