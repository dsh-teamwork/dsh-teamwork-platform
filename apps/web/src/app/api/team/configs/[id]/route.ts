// An admin edits (naming the version it read) or deletes one configuration.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteConfig, updateConfig } from '@/lib/team';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await updateConfig(user.id, (await params).id, await readJson(request)));
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/team/configs/[id]');
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    await deleteConfig((await requireUser(request)).id, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/team/configs/[id]');
  }
}
