/**
 * @dsh-teamwork/shared/server — the server-only half, for the Next.js apps: what sits
 * on top of either sign-in strategy. The strategies themselves are their own
 * entries (`@dsh-teamwork/shared/server/supabase`, `@dsh-teamwork/shared/server/nextauth`) so
 * an app loads only the one it runs and `pnpm rename` can delete the other. The
 * root entry stays isomorphic because client components import it; nothing
 * here may be imported from there.
 */

import 'server-only';

export { analyticsClient, captureServerEvent } from './analytics';
export { requestOrigin } from './origin';
export type { AuthOptions } from './auth/options';
export { createUserResolver, UnauthorizedError } from './auth/user';
