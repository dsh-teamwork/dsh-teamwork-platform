// An admin lists the team's providers (never their keys), or adds one.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createProvider, listProviders } from '@/lib/team';

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listProviders((await requireUser(request)).id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/team/providers');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createProvider(user.id, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/team/providers');
  }
}
