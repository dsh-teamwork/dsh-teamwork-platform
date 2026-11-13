// An admin lists the team's providers (never a key) or adds one.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createProvider, listProviders } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await listProviders(user.id, (await params).teamId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams/[teamId]/providers');
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createProvider(user.id, (await params).teamId, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams/[teamId]/providers');
  }
}
