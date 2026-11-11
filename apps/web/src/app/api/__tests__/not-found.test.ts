/**
 * An address under /api that no route claims answers in the API's own error
 * shape. Without the catch-all it is Next's HTML 404 page, which a client
 * parsing `{ error }` can only report as a bare status.
 */

import { describe, expect, it, vi } from 'vitest';

// `@/lib/api` reaches the app's sign-in strategy, which this route never
// calls; stubbing it keeps the suite free of whichever provider `pnpm rename`
// kept (next-auth cannot be loaded outside Next's own resolver).
vi.mock('@/lib/auth/strategy', () => ({ strategy: {} }));

const route = await import('../[...path]/route');

describe('/api/* with no route', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s is a JSON 404', async (method) => {
    const response = await route[method]();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});
