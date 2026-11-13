// The teams the caller is in, or create one; the caller becomes its admin.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createTeam, teamsOf } from '@/lib/team';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await teamsOf(user.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createTeam(user.id, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams');
  }
}
