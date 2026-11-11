// An admin adds a member by email, where the instance holds passwords.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { addMember } from '@/lib/team';

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await addMember(user.id, await readJson(request)), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/team/members');
  }
}
