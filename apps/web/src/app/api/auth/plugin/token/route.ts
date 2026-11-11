// Trades the code /plugin showed and the plugin's PKCE verifier for a Bearer token.
import { nextAuth } from '@/lib/auth/nextauth';

export const POST = (request: Request) => nextAuth.plugin.redeem(request);
