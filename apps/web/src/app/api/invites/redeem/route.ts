// Spend an invitation token and join its team.
import { NextResponse } from 'next/server';

import { handleRouteError, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { redeemInvite } from '@/lib/team';

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await redeemInvite(user.id, await readJson(request)));
  } catch (error) {
    return handleRouteError(error, 'POST /api/invites/redeem');
  }
}
