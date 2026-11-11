/**
 * The DSH plugin's credentials under NextAuth, and nothing else.
 *
 * NextAuth has no flow for a client outside the browser, so the plugin signs in
 * through the website and is handed a session token at the end (`plugin.ts`).
 * The hand-off is PKCE: the plugin sends a challenge, the site shows a
 * short-lived *code* bound to it, and the plugin trades code + verifier for the
 * token. Anybody else who sees the code holds something they cannot redeem.
 *
 * Every value is an Auth.js JWE under AUTH_SECRET, each with its own salt, so
 * a hand-off code is not a session and a browser cookie is not a Bearer token.
 * Stateless on purpose: nothing here needs a table.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { normalizeEmail, type Identity, type SignInMethod } from '../../../auth';
import { decode, encode } from 'next-auth/jwt';

const CODE_SALT = 'dsh-teamwork.plugin-handoff';
const BEARER_SALT = 'dsh-teamwork.plugin-session';
const CODE_MAX_AGE = 120;

/** How long a session lives, in the browser and in the plugin alike. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error('AUTH_SECRET is not set');
  return value;
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

interface Who {
  email: string;
  via: SignInMethod;
  name?: string | null;
  picture?: string | null;
}

export async function mintHandoffCode(who: Who, challenge: string): Promise<string> {
  return encode({
    token: { sub: normalizeEmail(who.email), email: who.email, name: who.name, picture: who.picture, via: who.via, challenge },
    secret: secret(),
    salt: CODE_SALT,
    maxAge: CODE_MAX_AGE,
  });
}

/** A Bearer token for the code, or null when the code or the verifier is wrong. */
export async function redeemHandoffCode(
  code: string,
  verifier: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const claims = await decode({ token: code, secret: secret(), salt: CODE_SALT }).catch(() => null);
  if (!claims?.sub || typeof claims.challenge !== 'string' || claims.challenge !== challengeOf(verifier)) return null;
  const token = await encode({
    token: { sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture, via: claims.via },
    secret: secret(),
    salt: BEARER_SALT,
    maxAge: SESSION_MAX_AGE,
  });
  return { token, expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString() };
}

export async function identityFromBearer(token: string): Promise<Identity | null> {
  const claims = await decode({ token, secret: secret(), salt: BEARER_SALT }).catch(() => null);
  if (!claims?.sub || typeof claims.email !== 'string') return null;
  return {
    strategy: 'nextauth',
    subject: claims.sub,
    email: normalizeEmail(claims.email),
    via: claims.via === 'google' ? 'google' : 'email',
    ...(claims.name ? { name: claims.name } : {}),
    ...(claims.picture ? { image: claims.picture } : {}),
  };
}
