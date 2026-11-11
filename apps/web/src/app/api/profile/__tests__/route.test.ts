/**
 * The shared half of the sign-in seam, driven through a real route and a real
 * database: whatever identity the strategy reports, the route answers for the
 * same profile row, and a request with none is a 401 in the shared error shape.
 * The strategy itself is the only thing stubbed, which is the point — either
 * one plugs in here.
 */

import type { Identity } from '@dsh-teamwork/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const who = vi.hoisted(() => ({ current: null as Identity | null }));
vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => who.current } }));
// React's per-request `cache` only exists inside a server render.
vi.mock('react', async (original) => ({ ...(await original<object>()), cache: <T>(fn: T) => fn }));

const { GET, PATCH } = await import('../route');
const { prisma } = await import('@/lib/prisma');

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('/api/profile without an identity', () => {
  beforeEach(() => {
    who.current = null;
  });

  it('is a 401 with a code, not a sentence', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});

describe.skipIf(!hasDatabase)('/api/profile with an identity', () => {
  const subject = `test:${Date.now()}`;

  beforeEach(() => {
    who.current = { strategy: 'nextauth', subject, email: 'seam@example.com', via: 'email', name: 'Seam' };
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { authId: subject } });
  });

  it('creates the profile on first sight and answers in the wire shape', async () => {
    const response = await GET(new Request('http://localhost/api/profile'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ email: 'seam@example.com', name: 'Seam', locale: null });
  });

  it('applies a valid patch and rejects an invalid one with its issues', async () => {
    const ok = await PATCH(
      new Request('http://localhost/api/profile', { method: 'PATCH', body: JSON.stringify({ locale: 'zh-CN' }) }),
    );
    expect(await ok.json()).toMatchObject({ locale: 'zh-CN' });

    const bad = await PATCH(
      new Request('http://localhost/api/profile', { method: 'PATCH', body: JSON.stringify({ locale: 'fr' }) }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_request', issues: [{ path: ['locale'] }] });
  });

  it('answers a body that is not JSON with a 400, not a 500', async () => {
    const response = await PATCH(new Request('http://localhost/api/profile', { method: 'PATCH', body: '{' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });
});
