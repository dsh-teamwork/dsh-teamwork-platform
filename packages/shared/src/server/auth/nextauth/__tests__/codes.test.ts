import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('email sign-in codes', async () => {
  process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-a-key';
  const { consumeCode, issueCode, MAX_ATTEMPTS, MAX_CODES_PER_WINDOW, CODE_TTL_MS } = await import('../codes');
  const { getPrisma } = await import('@dsh-teamwork/db');
  const prisma = getPrisma();
  const email = `codes-${Date.now()}@example.com`;

  const clear = () => prisma.verificationCode.deleteMany({ where: { email } });
  beforeAll(clear);
  beforeEach(clear);
  afterAll(clear);

  async function issue(now?: Date) {
    const issued = await issueCode(email, now);
    if (!('code' in issued)) throw new Error(issued.error);
    return issued.code;
  }

  it('never stores the code itself', async () => {
    const code = await issue();
    const row = await prisma.verificationCode.findFirstOrThrow({ where: { email } });
    expect(row.codeHash).not.toContain(code);
  });

  it('accepts the code once and consumes it', async () => {
    const code = await issue();
    expect(await consumeCode(email, code)).toBeNull();
    expect(await consumeCode(email, code)).toBe('invalid_code');
  });

  it('stops accepting even the right code after too many wrong guesses', async () => {
    const code = await issue();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(await consumeCode(email, wrong)).toBe('invalid_code');
    expect(await consumeCode(email, code)).toBe('too_many_attempts');
  });

  it('expires', async () => {
    const issuedAt = new Date(Date.now() - CODE_TTL_MS - 1000);
    const code = await issue(issuedAt);
    expect(await consumeCode(email, code)).toBe('code_expired');
  });

  it('rate-limits how many codes an address can be sent', async () => {
    for (let i = 0; i < MAX_CODES_PER_WINDOW; i++) await issue();
    expect(await issueCode(email)).toEqual({ error: 'too_many_attempts' });
  });

  it('counts every concurrent guess, so a burst cannot outrun the attempt limit', async () => {
    const code = await issue();
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 40 }, () => consumeCode(email, wrong)));
    const row = await prisma.verificationCode.findFirstOrThrow({ where: { email } });
    expect(row.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
    // Every guess in the burst either spent an attempt or was refused without
    // being checked, so the budget is gone and the right code is refused too.
    expect(await consumeCode(email, code)).toBe('too_many_attempts');
  });

  it('holds the per-address limit under a burst of concurrent sends', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => issueCode(email)));
    expect(results.filter((r) => 'code' in r)).toHaveLength(MAX_CODES_PER_WINDOW);
    expect(await prisma.verificationCode.count({ where: { email } })).toBe(MAX_CODES_PER_WINDOW);
  });
});
