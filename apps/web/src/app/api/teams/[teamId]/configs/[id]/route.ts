// An admin edits (naming the version it read) or deletes one configuration.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteConfig, updateConfig } from '@/lib/team';

type Context = { params: Promise<{ teamId: string; id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, id } = await params;
    return NextResponse.json(await updateConfig(user.id, teamId, id, await readJson(request)));
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/teams/[teamId]/configs/[id]');
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const { teamId, id } = await params;
    await deleteConfig(user.id, teamId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/teams/[teamId]/configs/[id]');
  }
}
