// An admin moves a provider or replaces its key, or removes it.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteProvider, updateProvider } from '@/lib/team';

type Context = { params: Promise<{ teamId: string; id: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, id } = await params;
    return NextResponse.json(await updateProvider(user.id, teamId, id, await readJson(request)));
  } catch (error) {
    return handleRouteError(error, 'PUT /api/teams/[teamId]/providers/[id]');
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, id } = await params;
    await deleteProvider(user.id, teamId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/teams/[teamId]/providers/[id]');
  }
}
