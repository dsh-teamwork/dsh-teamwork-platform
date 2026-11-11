/**
 * The signed-in profile — the worked example of the mobile → web → Prisma
 * path. The mobile app calls it with a Bearer token, the browser with its
 * session cookie; `requireUser(request)` accepts either, under either strategy.
 */

import { ProfileSchema, UpdateProfileSchema, type Profile } from '@dsh-teamwork/shared';
import type { User } from '@dsh-teamwork/db';
import { analyticsClient, captureServerEvent } from '@dsh-teamwork/shared/server';
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { handleRouteError, readJson } from '@/lib/api';
import { prisma } from '@/lib/prisma';

function toProfile(user: User): Profile {
  return ProfileSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    locale: user.locale,
  });
}

export async function GET(request: Request) {
  try {
    return NextResponse.json(toProfile(await requireUser(request)));
  } catch (error) {
    return handleRouteError(error, 'GET /api/profile');
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const patch = UpdateProfileSchema.parse(await readJson(request));
    const updated = await prisma.user.update({ where: { id: user.id }, data: patch });
    const fields = (['name', 'locale'] as const).filter((field) => patch[field] !== undefined);
    if (fields.length) captureServerEvent(user.id, 'profile_updated', { fields, client: analyticsClient(request) });
    return NextResponse.json(toProfile(updated));
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/profile');
  }
}
