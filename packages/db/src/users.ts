/**
 * The profile row behind a verified identity.
 *
 * Neither sign-in strategy tells this application when an account is minted —
 * Supabase can create one from a magic link, an OAuth callback or its own
 * dashboard, and a NextAuth JWT session writes nothing — so the row is
 * reconciled on the first authenticated request instead, on every request.
 * The common case, a known account with an unchanged address, is one read and
 * no write.
 *
 * `created` is true for exactly one request per account: when two first
 * requests race, the loser meets the unique index and reads the winner's row.
 * That is what lets a caller report a sign-up once.
 */

import { Prisma, type PrismaClient, type User } from './generated/prisma/index.js';

/** Structurally `Identity` from `@dsh-teamwork/shared`; restated so the schema package depends on nothing. */
export interface VerifiedIdentity {
  subject: string;
  email: string;
  name?: string;
  image?: string;
}

export interface EnsuredUser {
  user: User;
  created: boolean;
}

export async function ensureUser(prisma: PrismaClient, identity: VerifiedIdentity): Promise<EnsuredUser> {
  const where = { authId: identity.subject };
  const existing = await prisma.user.findUnique({ where });
  if (existing) {
    // The address follows the identity provider, which is where it is
    // verified. Name and picture are only seeded: once the row exists they are
    // the user's to edit, and a sign-in must not undo that.
    if (existing.email === identity.email) return { user: existing, created: false };
    return { user: await prisma.user.update({ where, data: { email: identity.email } }), created: false };
  }
  try {
    const user = await prisma.user.create({
      data: { authId: identity.subject, email: identity.email, name: identity.name ?? null, image: identity.image ?? null },
    });
    return { user, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    return ensureUser(prisma, identity);
  }
}
