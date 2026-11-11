import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The password door's promises (ADR 0006), against a real database: what a
 * mocked Prisma cannot show is a burst of concurrent guesses racing for the
 * same counter, or two people racing for the first account.
 */
describe('passwords', async () => {
  process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-a-key';
  const passwords = await import('../passwords');
  const { getPrisma } = await import('@dsh-teamwork/db');
  const prisma = getPrisma();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `passwords-${suffix}@example.test`;
  let userId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { authId: email, email } })).id;
    await passwords.setPassword(userId, 'correct horse battery', false);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
  });

  it('stores scrypt with its parameters, never the password', async () => {
    const row = await prisma.password.findUniqueOrThrow({ where: { userId } });
    expect(row.hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(row.hash).not.toContain('correct horse');
  });

  it('signs in with the right password, and answers the same for a wrong one and an unknown address', async () => {
    await expect(passwords.checkPassword(email.toUpperCase(), 'correct horse battery')).resolves.toEqual({ userId, mustChange: false });
    await expect(passwords.checkPassword(email, 'wrong password!')).resolves.toEqual({ error: 'invalid_credentials' });
    await expect(passwords.checkPassword(`nobody-${suffix}@example.test`, 'correct horse battery')).resolves.toEqual({
      error: 'invalid_credentials',
    });
  });

  it('spends a guess before comparing, so a concurrent burst gets no more than the limit', async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 30 }, () => passwords.checkPassword(email, 'not the password', now)));
    const compared = results.filter((r) => 'error' in r && r.error === 'invalid_credentials');
    expect(compared.length).toBeLessThanOrEqual(passwords.MAX_FAILURES);
    // The limit holds for the right password too, until the window has passed.
    await expect(passwords.checkPassword(email, 'correct horse battery', now)).resolves.toEqual({ error: 'too_many_attempts' });
    const later = new Date(now.getTime() + passwords.FAILURE_WINDOW_MS + 1000);
    await expect(passwords.checkPassword(email, 'correct horse battery', later)).resolves.toEqual({ userId, mustChange: false });
  });

  it('clears counted guesses when a password is set, and carries the must-change mark', async () => {
    await passwords.setPassword(userId, 'a first password', true);
    await expect(passwords.mustChangePassword(userId)).resolves.toBe(true);
    await expect(passwords.checkPassword(email, 'a first password')).resolves.toEqual({ userId, mustChange: true });
    await expect(passwords.checkPassword(email, 'correct horse battery')).resolves.toEqual({ error: 'invalid_credentials' });
  });

  it('generates first passwords long enough to hand over', () => {
    const first = passwords.generatePassword();
    expect(first).toMatch(/^[\w-]{20}$/);
    expect(passwords.generatePassword()).not.toBe(first);
  });
});

// The first account exists once per instance, so this needs a database no
// other suite writes passwords into: the in-memory PGlite. On a shared
// Postgres another workspace's suite may hold a password at the same moment.
describe.skipIf(Boolean(process.env.DATABASE_URL))('the first account', async () => {
  process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-a-key';
  const passwords = await import('../passwords');
  const { getPrisma } = await import('@dsh-teamwork/db');
  const prisma = getPrisma();

  beforeAll(async () => {
    await prisma.password.deleteMany();
  });

  it('is claimed once, with the token only AUTH_SECRET derives, by one of two racing claims', async () => {
    await expect(passwords.setupOpen()).resolves.toBe(true);
    await expect(passwords.claimFirstAccount('not-the-token', 'first@example.test', 'long enough password')).resolves.toBe('setup_closed');

    const token = passwords.setupToken();
    const claims = await Promise.all(
      ['first@example.test', 'second@example.test'].map((address) => passwords.claimFirstAccount(token, address, 'long enough password')),
    );
    expect(claims.filter((refused) => refused === null)).toHaveLength(1);
    expect(claims.filter((refused) => refused === 'setup_closed')).toHaveLength(1);
    await expect(passwords.setupOpen()).resolves.toBe(false);
    await expect(passwords.claimFirstAccount(token, 'third@example.test', 'long enough password')).resolves.toBe('setup_closed');
  });
});
