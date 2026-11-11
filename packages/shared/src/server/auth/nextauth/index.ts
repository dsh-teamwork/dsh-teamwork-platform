/**
 * The NextAuth (Auth.js v5) strategy (docs/tech/architecture.md; CLAUDE.md "Sign-in"), as a
 * factory each app calls once.
 *
 * Google and, where the app offers it, an emailed code; JWT sessions and no
 * adapter, so `User` stays the one profile table under either strategy and a
 * session needs no table of its own. The price, chosen deliberately: a session
 * cannot be revoked before it expires.
 *
 * The token's subject is the lower-cased verified email for both doors, so
 * Google and a code for one address are one account — which is what Supabase
 * does for the other strategy.
 */

import 'server-only';

import NextAuth, { AuthError as NextAuthError, CredentialsSignin, type Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { NextResponse, type NextRequest } from 'next/server';

import {
  bearerFromHeader,
  EmailSchema,
  normalizeEmail,
  returnPath,
  VerifyCodeSchema,
  type AuthError,
  type AuthResult,
  type Identity,
  type SignInMethod,
} from '../../../auth';
import { admitted, googleConfigured, type AuthOptions } from '../options';
import { consumeCode, issueCode } from './codes';
import { sendCodeEmail } from './email';
import { createPluginHandoff } from './plugin';
import { identityFromBearer, SESSION_MAX_AGE } from './tokens';

/** Carries an `AuthError` code out of `authorize` to the action that called it. */
class CodeRejected extends CredentialsSignin {
  constructor(error: AuthError) {
    super();
    this.code = error;
  }
}

/**
 * Auth.js's cookies under names of this app's own, for the reason
 * `AuthOptions.cookieName` gives. Over https they take the `__Secure-` prefix
 * Auth.js would have used, which the browser only accepts with `Secure`.
 */
function cookies(name: string) {
  // Decided once, not per request: by the configured URL when there is one,
  // otherwise by whether this is a production build (which is served over
  // https everywhere it is deployed).
  const url = process.env.AUTH_URL ?? process.env.APP_URL;
  const secure = url ? url.startsWith('https://') : process.env.NODE_ENV === 'production';
  const cookie = (suffix: string, httpOnly = true) => ({
    name: `${secure ? '__Secure-' : ''}${name}.${suffix}`,
    options: { httpOnly, sameSite: 'lax' as const, path: '/', secure },
  });
  return {
    sessionToken: cookie('session-token'),
    callbackUrl: cookie('callback-url'),
    csrfToken: cookie('csrf-token'),
    pkceCodeVerifier: cookie('pkce.code_verifier'),
    state: cookie('state'),
    nonce: cookie('nonce'),
  };
}

export function createNextAuth(options: AuthOptions) {
  const google = googleConfigured();
  const { handlers, auth, signIn, signOut: endSession } = NextAuth({
    trustHost: true,
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE },
    cookies: cookies(options.cookieName),
    pages: { signIn: options.signInPath, error: options.signInPath },
    providers: [
      ...(google ? [Google] : []),
      ...(options.emailCodes
        ? [
            Credentials({
              id: 'email-code',
              credentials: { email: {}, code: {} },
              async authorize(credentials) {
                const parsed = VerifyCodeSchema.safeParse(credentials);
                if (!parsed.success) throw new CodeRejected('invalid_code');
                const error = await consumeCode(parsed.data.email, parsed.data.code);
                if (error) throw new CodeRejected(error);
                return { id: parsed.data.email, email: parsed.data.email };
              },
            }),
          ]
        : []),
    ],
    callbacks: {
      signIn({ account, profile }) {
        // An unverified Google address would let anybody claim an account by
        // email alone.
        if (account?.provider === 'google') return profile?.email_verified === true;
        return true;
      },
      jwt({ token, user, account }) {
        if (user?.email) token.sub = normalizeEmail(user.email);
        // Set once, at sign-in: which door this session came through.
        if (account) token.via = account.provider === 'google' ? 'google' : 'email';
        return token;
      },
      session({ session, token }) {
        return { ...session, via: token.via === 'google' ? 'google' : 'email' };
      },
    },
  });

  /** The session an Auth.js cookie carries, with the door it came through. */
  async function session(): Promise<{ email: string; name?: string | null; picture?: string | null; via: SignInMethod } | null> {
    if (!process.env.AUTH_SECRET) return null;
    const current = (await auth()) as (Session & { via?: SignInMethod }) | null;
    const email = current?.user?.email;
    if (!email) return null;
    return { email, name: current.user?.name, picture: current.user?.image, via: current.via === 'google' ? 'google' : 'email' };
  }

  /** The plugin's Bearer token first, the browser's session cookie second. */
  async function identity(request?: Request): Promise<Identity | null> {
    const token = bearerFromHeader(request?.headers.get('authorization'));
    if (token) return admitted(options, await identityFromBearer(token));
    const who = await session();
    if (!who) return null;
    return admitted(options, {
      strategy: 'nextauth',
      subject: normalizeEmail(who.email),
      email: normalizeEmail(who.email),
      via: who.via,
      ...(who.name ? { name: who.name } : {}),
      ...(who.picture ? { image: who.picture } : {}),
    });
  }

  /** A JWT session carries itself; there is nothing to rotate at the edge. */
  async function refreshSession(request: NextRequest): Promise<NextResponse> {
    return NextResponse.next({ request });
  }

  async function startGoogle(next: string): Promise<AuthResult> {
    if (!google) return { ok: false, error: 'not_allowed' };
    if (!process.env.AUTH_SECRET) return { ok: false, error: 'unavailable' };
    // Redirects to Google; a thrown NEXT_REDIRECT is how it gets there.
    await signIn('google', { redirectTo: returnPath(next, options.afterSignIn) });
    return { ok: true };
  }

  async function sendCode(email: string): Promise<AuthResult> {
    if (!options.emailCodes) return { ok: false, error: 'not_allowed' };
    const parsed = EmailSchema.safeParse({ email });
    if (!parsed.success) return { ok: false, error: 'invalid_email' };
    if (!process.env.AUTH_SECRET) return { ok: false, error: 'unavailable' };
    const issued = await issueCode(parsed.data.email);
    if ('error' in issued) return { ok: false, error: issued.error };
    return (await sendCodeEmail(parsed.data.email, issued.code)) ? { ok: true } : { ok: false, error: 'unavailable' };
  }

  async function verifyCode(email: string, code: string, next: string): Promise<AuthResult> {
    if (!options.emailCodes) return { ok: false, error: 'not_allowed' };
    try {
      await signIn('email-code', { email, code, redirectTo: returnPath(next, options.afterSignIn) });
      return { ok: true };
    } catch (error) {
      if (error instanceof CredentialsSignin) return { ok: false, error: error.code as AuthError };
      if (error instanceof NextAuthError) {
        console.error('[auth] sign-in failed', error.type);
        return { ok: false, error: 'unavailable' };
      }
      throw error; // NEXT_REDIRECT, i.e. success.
    }
  }

  async function signOut(): Promise<void> {
    await endSession({ redirectTo: '/' });
  }

  return {
    /** Whether the Google door exists, for the sign-in form. */
    google,
    handlers,
    identity,
    refreshSession,
    startGoogle,
    sendCode,
    verifyCode,
    signOut,
    plugin: createPluginHandoff(session),
  };
}
