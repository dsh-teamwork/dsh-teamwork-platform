/**
 * Email sign-in codes under NextAuth — what Supabase does for the other
 * strategy: generate, store, send, and check a six-digit code.
 *
 * Only a keyed hash is stored, so reading the table mints nothing. A code
 * lives ten minutes and is checked at most five times; an address can be sent
 * five codes in fifteen minutes. Those three numbers are the whole of the
 * brute-force defence, and they are small on purpose: six digits is a million
 * guesses, and five per code is what keeps that out of reach.
 */

import 'server-only';

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { getPrisma } from '@dsh-teamwork/db';

import type { AuthError } from '../../../auth';

const prisma = () => getPrisma();

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_WINDOW = 5;
export const WINDOW_MS = 15 * 60 * 1000;

function hashCode(email: string, code: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return createHmac('sha256', secret).update(`${email}\n${code}`).digest('hex');
}

/**
 * A new code for `email` (already normalised), or why not.
 *
 * The count and the insert run under a transaction-scoped advisory lock keyed
 * by the address, so concurrent sends for one address queue behind each other
 * and the limit holds; a plain count-then-create lets a burst all see "under
 * the limit" before any of them has written.
 */
export async function issueCode(email: string, now = new Date()): Promise<{ code: string } | { error: AuthError }> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const issued = await prisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`verification-code:${email}`}))`;
    const recent = await tx.verificationCode.count({
      where: { email, createdAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
    });
    if (recent >= MAX_CODES_PER_WINDOW) return false;
    await tx.verificationCode.create({
      data: { email, codeHash: hashCode(email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now },
    });
    return true;
  });
  return issued ? { code } : { error: 'too_many_attempts' };
}

/**
 * Check a code against the newest one issued to `email`. Answers null on
 * success, otherwise the error the form should show.
 *
 * **The attempt is spent before the code is compared.** Claiming it is one
 * conditional update (`attempts < MAX_ATTEMPTS`), and only a guess that won a
 * claim is checked at all — so a burst of concurrent guesses gets at most
 * MAX_ATTEMPTS comparisons between them, however many arrive at once. A match
 * then consumes every code for the address.
 */
export async function consumeCode(email: string, code: string, now = new Date()): Promise<AuthError | null> {
  const latest = await prisma().verificationCode.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
  if (!latest) return 'invalid_code';
  if (latest.expiresAt <= now) return 'code_expired';

  const claimed = await prisma().verificationCode.updateMany({
    where: { id: latest.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'too_many_attempts';

  const expected = Buffer.from(latest.codeHash, 'hex');
  const given = Buffer.from(hashCode(email, code), 'hex');
  if (!timingSafeEqual(expected, given)) return 'invalid_code';

  // Only one of several concurrent correct guesses may sign in: the delete is
  // the second claim, and a request whose row is already gone lost it.
  const consumed = await prisma().verificationCode.deleteMany({ where: { id: latest.id } });
  if (consumed.count === 0) return 'invalid_code';
  await prisma().verificationCode.deleteMany({ where: { email } });
  return null;
}
