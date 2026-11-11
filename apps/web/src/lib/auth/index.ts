import 'server-only';

import { createUserResolver } from '@dsh-teamwork/shared/server';

import { strategy } from './strategy';

export { UnauthorizedError } from '@dsh-teamwork/shared/server';

/** `currentUser()` / `requireUser()` for this app, over whichever strategy it runs. */
export const { currentUser, requireUser } = createUserResolver(strategy.identity);
