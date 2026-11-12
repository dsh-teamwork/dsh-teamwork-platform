// An admin moves a provider or replaces its key, or removes a provider nothing calls.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { deleteProvider, updateProvider } from '@/lib/team';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await updateProvider(user.id, (await params).id, await readJson(request)));
  } catch (error) {
    return handleRouteError(error, 'PUT /api/team/providers/[id]');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await deleteProvider((await requireUser(request)).id, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/team/providers/[id]');
  }
}
