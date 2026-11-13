// One team's configuration, or an admin publishes a new entry.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createConfig, listConfigs } from '@/lib/team';

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await listConfigs(user.id, (await params).teamId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams/[teamId]/configs');
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createConfig(user.id, (await params).teamId, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/teams/[teamId]/configs');
  }
}
