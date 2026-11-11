import type { NextRequest } from 'next/server';

import { strategy } from '@/lib/auth/strategy';

// One job: keep the session cookie fresh before a Server Component renders,
// because a Server Component cannot write cookies. Route protection is not
// here — each page redirects and each route answers 401 beside the data it
// guards, rather than in a path list at the edge that drifts from them.
export default function proxy(request: NextRequest) {
  return strategy.refreshSession(request);
}

export const config = {
  // `api` is excluded: a route handler may write cookies itself, and the plugin
  // app calls it with a Bearer token that has no cookie to refresh.
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
