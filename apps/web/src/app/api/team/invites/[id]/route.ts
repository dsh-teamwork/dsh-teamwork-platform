// An admin revokes an invitation.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { revokeInvite } from '@/lib/team';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await revokeInvite((await requireUser(request)).id, (await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/team/invites/[id]');
  }
}
