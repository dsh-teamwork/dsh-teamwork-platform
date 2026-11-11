// An admin gives a member a new first password, which is shown once.
import { NextResponse } from 'next/server';

import { handleRouteError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { resetMemberPassword } from '@/lib/team';

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await resetMemberPassword(user.id, (await params).userId));
  } catch (error) {
    return handleRouteError(error, 'POST /api/team/members/[userId]/password');
  }
}
