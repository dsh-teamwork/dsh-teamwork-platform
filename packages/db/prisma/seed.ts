/**
 * `pnpm db:seed` — rows a fresh local database should start with.
 *
 * Empty on purpose: seed ships no product. A product adds what its first
 * screen needs to show something, and keeps it idempotent (upserts), because
 * this runs again after every `pnpm db:reset`.
 */

import { createPrismaClient } from '../src/index';

const prisma = createPrismaClient();

async function main() {
  console.log('Seed complete (nothing to insert).');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
