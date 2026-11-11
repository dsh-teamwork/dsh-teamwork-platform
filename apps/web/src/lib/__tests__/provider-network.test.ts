/**
 * The network rule on a real connection (ADR 0006): `providerFetch` resolves
 * and connects through its guarded agent, so a provider on this machine is
 * reachable only where the instance allows private providers.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => null } }));

const { providerFetch } = await import('../provider-network');

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => vi.unstubAllEnvs());

describe('providerFetch', () => {
  it('calls a provider on this machine where private providers are allowed', async () => {
    vi.stubEnv('ALLOW_PRIVATE_PROVIDERS', 'true');
    for (const host of ['127.0.0.1', 'localhost']) {
      const response = await providerFetch(`http://${host}:${port}/v1/models`, {});
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it('refuses it otherwise, before anything is sent', async () => {
    const requests = vi.fn();
    server.on('request', requests);
    await expect(providerFetch(`http://127.0.0.1:${port}/v1/models`, {})).rejects.toMatchObject({ code: 'provider_address_refused' });
    await expect(providerFetch(`https://localhost:${port}/v1/models`, {})).rejects.toMatchObject({ code: 'provider_address_refused' });
    server.off('request', requests);
    expect(requests).not.toHaveBeenCalled();
  });
});
