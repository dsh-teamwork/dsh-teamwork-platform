// What the plugin syncs: every team the caller is in, each with its configuration (ADR 0013).
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { configSnapshot } from '@/lib/team';

export async function GET(request: Request) {
  try {
    const snapshot = await configSnapshot((await requireUser(request)).id);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/configs');
  }
}
