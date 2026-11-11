/**
 * Who is asking — written once, for either strategy, for the product app.
 *
 * The strategy's `identity()` answers *who the identity provider says this
 * is*; `currentUser()` answers *which profile that is*, creating the row on
 * first sight (`ensureUser`) and reporting that sign-up once. Cached per
 * request, so a page that asks three times costs one verification and one read.
 */

import 'server-only';

import { ensureUser, getPrisma, type User } from '@dsh-teamwork/db';
import { cache } from 'react';

import type { Identity } from '../../auth';
import { analyticsClient, captureServerEvent } from '../analytics';

/** Thrown by `requireUser`; a route maps it to 401, a page redirects. */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export function createUserResolver(identity: (request?: Request) => Promise<Identity | null>) {
  const currentIdentity = cache((request?: Request) => identity(request));

  /** The signed-in profile, or null. Pass the request in a route the plugin calls with a Bearer token. */
  const currentUser = cache(async (request?: Request): Promise<User | null> => {
    const who = await currentIdentity(request);
    if (!who) return null;
    const { user, created } = await ensureUser(getPrisma(), who);
    if (created) captureServerEvent(user.id, 'user_signed_up', { via: who.via, client: analyticsClient(request) });
    return user;
  });

  async function requireUser(request?: Request): Promise<User> {
    const user = await currentUser(request);
    if (!user) throw new UnauthorizedError();
    return user;
  }

  return { currentIdentity, currentUser, requireUser };
}
