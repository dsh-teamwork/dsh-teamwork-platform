// The team's configuration snapshot (what the plugin syncs), or an admin publishes a new entry.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { createConfig, listConfigs } from '@/lib/team';

export async function GET(request: Request) {
  try {
    const snapshot = await listConfigs((await requireUser(request)).id);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/team/configs');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await createConfig(user.id, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/team/configs');
  }
}
