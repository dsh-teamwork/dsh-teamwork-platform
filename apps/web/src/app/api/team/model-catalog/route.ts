// For an admin choosing a team model: `?provider=` lists that provider's models, without it the providers.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { modelCatalog } from '@/lib/llm-gateway';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const provider = new URL(request.url).searchParams.get('provider');
    return NextResponse.json(await modelCatalog(user.id, provider, request.signal), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/team/model-catalog');
  }
}
