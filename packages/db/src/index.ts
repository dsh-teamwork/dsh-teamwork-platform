/**
 * The Prisma client, and the only way the rest of the workspace reaches it.
 *
 * The client is generated into `src/generated/prisma` (see prisma/schema/schema.prisma), so
 * callers import `PrismaClient`, the `Prisma` namespace and model types from
 * `@dsh-teamwork/db` — the bare `@prisma/client` package does not resolve to a
 * generated client here.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from './generated/prisma/index.js';
import { pgliteAdapter } from './pglite';

export { Prisma, PrismaClient } from './generated/prisma/index.js';
export type { ConfigKind, Invite, Membership, Team, TeamConfig, TeamRole, User } from './generated/prisma/index.js';
export { ensureUser, type EnsuredUser, type VerifiedIdentity } from './users';

/**
 * A client of its own. With a connection string — DATABASE_URL by default —
 * it is Postgres over a pool of its own; with none, it is this process's
 * PGlite in `PGLITE_DIR` (ADR 0006). Tests and scripts use this directly.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL || undefined): PrismaClient {
  const adapter = connectionString ? new PrismaPg(new Pool({ connectionString })) : pgliteAdapter();
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

// Kept on `globalThis` in development so a hot reload does not open a new pool
// each time and exhaust the database's connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The process-wide client for the Next.js apps.
 *
 * Created on first use rather than at import, so importing `@dsh-teamwork/db` — which
 * `next build` does while collecting page data — opens no connection.
 */
export function getPrisma(): PrismaClient {
  const client = globalForPrisma.prisma ?? createPrismaClient();
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  else globalForPrisma.prisma ??= client;
  return client;
}
