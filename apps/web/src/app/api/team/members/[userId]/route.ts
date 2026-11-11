// An admin removes a member.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { removeMember } from '@/lib/team';

export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await removeMember((await requireUser(request)).id, (await params).userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/team/members/[userId]');
  }
}
