// For an admin choosing team models: `?provider=` lists that provider's models.
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { modelCatalog } from '@/lib/llm-gateway';

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const provider = z.string().min(1).parse(new URL(request.url).searchParams.get('provider'));
    const catalog = await modelCatalog(user.id, (await params).teamId, provider, request.signal);
    return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'GET /api/teams/[teamId]/model-catalog');
  }
}
