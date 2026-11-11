/**
 * Passwords, the door of an instance that sends no email (ADR 0006): with no
 * `SMTP_URL`, an email and a password replace the emailed code.
 *
 * - **Hashing** is scrypt from `node:crypto`, its parameters stored beside
 *   each hash, so raising them later needs no migration: an old hash still
 *   verifies under the parameters it was made with.
 * - **Guesses** are limited per account the way codes are: the attempt is
 *   spent before the comparison, so a burst of concurrent guesses gets at most
 *   MAX_FAILURES comparisons per window between them.
 * - **The first account** is claimed with a link the server prints at start.
 *   Its token is derived from AUTH_SECRET, so only the operator can know it,
 *   and it works only while no password exists at all.
 *
 * Who may set whose password is the team's rule (`apps/web/src/lib/team.ts`);
 * this file only stores and checks.
 */

import 'server-only';

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { getPrisma } from '@dsh-teamwork/db';

import { normalizeEmail, type AuthError } from '../../../auth';

const prisma = () => getPrisma();

export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** 2^15 × 8 × 128 bytes: 32 MiB per hash, a fraction of a second on a server. */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_BYTES = 32;

function scrypt(password: string, salt: Buffer, options: { N: number; r: number; p: number }): Promise<Buffer> {
  const params: ScryptOptions = { ...options, maxmem: 256 * options.N * options.r };
  return new Promise((resolve, reject) =>
    scryptCallback(password.normalize('NFKC'), salt, KEY_BYTES, params, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$key`, both base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const given = await scrypt(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Checked against when no account matches, so an unknown address costs what a known one does. */
let decoy: Promise<string> | undefined;

/** A first password an admin hands over: 120 random bits, typeable. */
export function generatePassword(): string {
  return randomBytes(15).toString('base64url');
}

/**
 * Spend one guess on the account, or answer that its guesses are used up.
 * Two conditional updates, each atomic: open a new window if the last one
 * has passed, otherwise count into the current one while under the limit.
 */
async function claimGuess(userId: string, now: Date): Promise<boolean> {
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
  const fresh = await prisma().password.updateMany({
    where: { userId, OR: [{ failuresSince: null }, { failuresSince: { lte: windowStart } }] },
    data: { failures: 1, failuresSince: now },
  });
  if (fresh.count) return true;
  const counted = await prisma().password.updateMany({
    where: { userId, failures: { lt: MAX_FAILURES } },
    data: { failures: { increment: 1 } },
  });
  return counted.count > 0;
}

/** The account an email and a password sign in to, or why not. */
export async function checkPassword(
  email: string,
  password: string,
  now = new Date(),
): Promise<{ userId: string; mustChange: boolean } | { error: AuthError }> {
  const user = await prisma().user.findUnique({ where: { authId: normalizeEmail(email) }, include: { password: true } });
  if (!user?.password) {
    await verifyPassword(await (decoy ??= hashPassword(generatePassword())), password);
    return { error: 'invalid_credentials' };
  }
  if (!(await claimGuess(user.id, now))) return { error: 'too_many_attempts' };
  if (!(await verifyPassword(user.password.hash, password))) return { error: 'invalid_credentials' };
  await prisma().password.update({ where: { userId: user.id }, data: { failures: 0, failuresSince: null } });
  return { userId: user.id, mustChange: user.password.mustChange };
}

/** Sets or replaces a user's password, which clears the guesses counted against it. */
export async function setPassword(userId: string, password: string, mustChange: boolean): Promise<void> {
  const hash = await hashPassword(password);
  const data = { hash, mustChange, failures: 0, failuresSince: null };
  await prisma().password.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** Whether this user must replace a password an admin set before doing anything else. */
export async function mustChangePassword(userId: string): Promise<boolean> {
  const row = await prisma().password.findUnique({ where: { userId }, select: { mustChange: true } });
  return row?.mustChange ?? false;
}

/** The first account's token: derived, so it survives a restart and needs no table. */
export function setupToken(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return createHmac('sha256', secret).update('dsh-teamwork:first-account').digest('base64url');
}

/** Whether the first account is still to be claimed: no password exists yet. */
export async function setupOpen(): Promise<boolean> {
  return (await prisma().password.count()) === 0;
}

/**
 * Claims the first account. The check that no password exists and the write
 * run under one advisory lock, so two people racing for the link get one
 * account between them.
 */
export async function claimFirstAccount(token: string, email: string, password: string): Promise<AuthError | null> {
  const expected = Buffer.from(setupToken());
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'setup_closed';
  const authId = normalizeEmail(email);
  const hash = await hashPassword(password);
  return prisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dsh-teamwork:first-account'))`;
    if ((await tx.password.count()) > 0) return 'setup_closed';
    const user = await tx.user.upsert({ where: { authId }, create: { authId, email: authId }, update: {} });
    await tx.password.create({ data: { userId: user.id, hash, mustChange: false } });
    return null;
  });
}
