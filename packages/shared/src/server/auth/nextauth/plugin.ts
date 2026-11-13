/**
 * How the DSH plugin signs in under NextAuth.
 *
 *   /plugin?challenge=…               the page the plugin prints; a signed-in
 *                                     person confirms, and is shown a code
 *   POST /api/auth/plugin/token       { code, verifier } → { token, expiresAt }
 *
 * The plugin runs inside a DSH host that cannot receive a redirect, so the code
 * is shown to the person to paste back (`/teamwork authorize <code>`) rather than
 * sent anywhere. A phone app can receive one: with `&redirect_uri=…` under
 * `MOBILE_REDIRECT_URI` (its own URL scheme), the page sends the code there
 * after the same confirmation (docs/adr/0010-the-app-gets-its-code-back.md).
 * The target is never taken from the request alone, or the site would hand
 * codes to any URL a link names; unset, no code is sent anywhere. `tokens.ts` says why the hand-off is PKCE: a code read off
 * somebody's screen is useless without the verifier only their plugin holds.
 * Minting needs an explicit confirmation (a server action, origin-checked by
 * Next), so a link alone never produces a code.
 */

import 'server-only';

import { PLUGIN_CHALLENGE, type SignInMethod } from '../../../auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { mintHandoffCode, redeemHandoffCode } from './tokens';

const RedeemSchema = z.object({ code: z.string().min(1), verifier: z.string().min(43).max(128) });

const invalid = (status: number, error: string) => NextResponse.json({ error }, { status });

type CurrentSession = () => Promise<{ email: string; name?: string | null; picture?: string | null; via: SignInMethod } | null>;

export function createPluginHandoff(session: CurrentSession) {
  /** A code for the signed-in person bound to `challenge`, or null when nobody is signed in or the challenge is malformed. */
  async function mint(challenge: string): Promise<string | null> {
    if (!PLUGIN_CHALLENGE.test(challenge)) return null;
    const who = await session();
    return who ? mintHandoffCode(who, challenge) : null;
  }

  async function redeem(request: Request): Promise<Response> {
    const parsed = RedeemSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid(400, 'invalid_request');
    const issued = await redeemHandoffCode(parsed.data.code, parsed.data.verifier);
    return issued ? NextResponse.json(issued) : invalid(401, 'invalid_code');
  }

  /** `uri` when the code may be sent there instead of shown, else null. */
  function returnTo(uri: unknown): string | null {
    const prefix = process.env.MOBILE_REDIRECT_URI?.trim();
    return prefix && typeof uri === 'string' && uri.startsWith(prefix) ? uri : null;
  }

  return { mint, redeem, returnTo };
}
