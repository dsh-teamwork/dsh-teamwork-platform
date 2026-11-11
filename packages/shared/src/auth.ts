/**
 * The sign-in contract both strategies meet (docs/tech/architecture.md; CLAUDE.md "Sign-in").
 *
 * Whichever strategy a product keeps — Supabase or NextAuth — verifying a
 * request ends in an `Identity`, and nothing downstream of that learns which
 * strategy produced it. This file holds the parts that are the same under
 * both: the value itself, reading a bearer token, where to go after signing
 * in, the admin allowlist, and the shape of the email-code form. It is
 * isomorphic — no `process.env`, no Node, no React — because client
 * components read it too.
 */

import { z } from 'zod';

export type AuthStrategy = 'supabase' | 'nextauth';

/** Which door the session came through. Unknown is read as `email`, never as `google`. */
export type SignInMethod = 'google' | 'email';

export interface Identity {
  strategy: AuthStrategy;
  /**
   * What `User.authId` stores. Supabase: `auth.users.id`. NextAuth: the
   * lower-cased verified email, so Google and an emailed code prove the same
   * address and land on one account — which is what Supabase already does.
   */
  subject: string;
  email: string;
  /**
   * How this session was signed in. An app that offers only Google (the
   * console) refuses anything else here, because the identity provider is
   * shared: a code sent through the web app's form would otherwise open a
   * session the console accepts.
   */
  via: SignInMethod;
  name?: string;
  image?: string;
}

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const [scheme, value, extra] = header.trim().split(/\s+/);
  if (extra !== undefined || scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

/**
 * Where to go after signing in: a path on this site, or `fallback`.
 *
 * Only ever a path on this origin. Anything that could leave it — a protocol,
 * `//host`, a backslash a browser reads as a slash, a control character — is
 * the fallback instead: a sign-in page that sends people wherever its query
 * string says is how a phishing link borrows the product's name.
 */
export function returnPath(asked: unknown, fallback = '/'): string {
  if (typeof asked !== 'string' || asked.length > 512 || !asked.startsWith('/')) return fallback;
  if (asked.startsWith('//') || /[\\\u0000-\u001f]/.test(asked)) return fallback;
  const here = 'https://return.invalid';
  const url = new URL(asked, here);
  return url.origin === here ? `${url.pathname}${url.search}${url.hash}` : fallback;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The admin allowlist, from the raw `ADMIN_EMAILS` value (comma-separated).
 * An empty list admits nobody: a console with no allowlist is closed, never
 * open.
 */
export function parseAdminEmails(raw: string | null | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map(normalizeEmail).filter(Boolean));
}

export function isAdminEmail(email: string | null | undefined, raw: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails(raw).has(normalizeEmail(email));
}

/** The email-code form, validated the same way on every surface. */
const email = z.string().trim().toLowerCase().pipe(z.email());
export const EmailSchema = z.object({ email });
export const VerifyCodeSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'A code is six digits'),
});

/**
 * What a sign-in action answers with when it did not work. Codes, not
 * sentences: each surface words them in its own language.
 */
export const AUTH_ERRORS = [
  'invalid_email',
  'invalid_code',
  'code_expired',
  'too_many_attempts',
  'not_allowed',
  'unavailable',
] as const;
export type AuthError = (typeof AUTH_ERRORS)[number];

export type AuthResult = { ok: true } | { ok: false; error: AuthError };

/**
 * What a Supabase auth error means for the form, on the server and on the
 * phone alike. Structural, so this file still imports no Supabase code.
 */
export function supabaseAuthError(error: { status?: number; code?: string }): AuthError {
  if (error.status === 429) return 'too_many_attempts';
  if (error.code === 'otp_expired') return 'code_expired';
  if (error.code === 'signup_disabled' || error.code === 'email_address_not_authorized') return 'not_allowed';
  return 'invalid_code';
}

/** An RFC 7636 S256 challenge as the DSH plugin sends it: base64url of a SHA-256, 43 characters. */
export const PLUGIN_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
