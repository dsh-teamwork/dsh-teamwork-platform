import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, ensureUser, type PrismaClient } from '../index';

// The migrated database: PGlite in memory without DATABASE_URL, which applies
// the committed migrations as it opens, or Postgres with one, which
// `pnpm db:deploy` migrated. CI runs both.
describe('the migrated database', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { authId: { startsWith: 'test:' } } });
    await prisma.$disconnect();
  });

  it('mints a nanoid primary key in Postgres, not in the client', async () => {
    const user = await prisma.user.create({ data: { authId: 'test:nanoid', email: 'nanoid@example.com' } });
    expect(user.id).toMatch(/^[0-9A-Za-z_-]{21}$/);
  });

  it('holds authId unique, since it is the only link to the identity', async () => {
    await prisma.user.create({ data: { authId: 'test:unique', email: 'a@example.com' } });
    await expect(prisma.user.create({ data: { authId: 'test:unique', email: 'b@example.com' } })).rejects.toThrow();
  });

  it('creates the profile on first sight and keeps the user\'s own edits on the next', async () => {
    const identity = { subject: 'test:ensure', email: 'first@example.com', name: 'From Google' };
    const first = await ensureUser(prisma, identity);
    expect(first.created).toBe(true);
    expect(first.user.name).toBe('From Google');

    await prisma.user.update({ where: { id: first.user.id }, data: { name: 'Chosen' } });
    const again = await ensureUser(prisma, { ...identity, email: 'moved@example.com', name: 'From Google' });

    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.name).toBe('Chosen');
    expect(again.user.email).toBe('moved@example.com');
  });

  it('reports a new account once when its first requests race', async () => {
    // A sign-up is counted from `created`; two first requests landing together
    // must not count it twice, nor fail the one that loses.
    const identity = { subject: 'test:race', email: 'race@example.com' };
    const results = await Promise.all(Array.from({ length: 5 }, () => ensureUser(prisma, identity)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.user.id)).size).toBe(1);
  });
});
