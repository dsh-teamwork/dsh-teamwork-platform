/**
 * How the DSH plugin signs in under NextAuth.
 *
 *   /plugin?challenge=…               the page the plugin prints; a signed-in
 *                                     person confirms, and is shown a code
 *   POST /api/auth/plugin/token       { code, verifier } → { token, expiresAt }
 *
 * A code can go back to whoever asked for it instead of being pasted, through
 * `&redirect_uri=…`, after the same confirmation. Two addresses are accepted:
 * the DSH plugin's own listener on `http://127.0.0.1:<port>/…`
 * (docs/adr/0012-the-plugin-gets-its-code-back-on-loopback.md), and a phone
 * app's address under `MOBILE_REDIRECT_URI` (its own URL scheme;
 * docs/adr/0010-the-app-gets-its-code-back.md). Any other address makes the
 * link invalid, or the site would hand codes to any URL a link names. Without a
 * `redirect_uri` the code is shown, to paste back (`/teamwork authorize <code>`).
 * `tokens.ts` says why the hand-off is PKCE: a code that reaches the wrong
 * place is useless without the verifier only the requester holds.
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

/** `dsh`: the plugin's loopback listener. `app`: the phone app's own scheme. */
export interface ReturnTo { url: string; to: 'dsh' | 'app' }

/** RFC 8252 §7.3: plain http to the IPv4 loopback literal, on a port the plugin chose. */
function isLoopback(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' && !url.username && !url.password;
}

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

  /** Where the code may be sent instead of shown, and who listens there; null when nowhere. */
  function returnTo(uri: unknown): ReturnTo | null {
    if (typeof uri !== 'string') return null;
    if (isLoopback(uri)) return { url: uri, to: 'dsh' };
    const prefix = process.env.MOBILE_REDIRECT_URI?.trim();
    return prefix && uri.startsWith(prefix) ? { url: uri, to: 'app' } : null;
  }

  return { mint, redeem, returnTo };
}
