/**
 * The gateway's security boundary, with Prisma stubbed: the server alone
 * chooses where a call goes and with which key, only a team's own
 * configuration and providers can be named, an address must pass the network
 * rule (ADR 0006), and nothing from upstream leaks back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// The strategy is next-auth, which needs a Next runtime; nothing here signs in.
vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => null } }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    teamConfig: { findFirst: vi.fn() },
    teamProvider: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));
// Where a provider's host resolves decides whether it may be called.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const { prisma } = await import('@/lib/prisma');
const { lookup } = await import('node:dns/promises');
const { modelCatalog, proxyCompletion } = await import('../llm-gateway');
const { encryptProviderKey } = await import('../provider-keys');
const { guardedLookup } = await import('../provider-network');

const SECRET = Buffer.alloc(32, 7).toString('base64');
const membership = vi.mocked(prisma.membership.findUnique);
const findConfig = vi.mocked(prisma.teamConfig.findFirst);
const findProvider = vi.mocked(prisma.teamProvider.findUnique);
const signal = () => new AbortController().signal;
const row = (id: string, kind: 'model' | 'preset', data: object) =>
  ({ id, teamId: 't', kind, name: id, data, version: 1, createdAt: new Date(), updatedAt: new Date() }) as never;
const resolvesTo = (...addresses: string[]) =>
  vi.mocked(lookup).mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never);

function provider(baseUrl: string, name = 'kimi') {
  vi.stubEnv('PROVIDER_KEYS_SECRET', SECRET);
  findProvider.mockResolvedValue({
    id: 'pr',
    teamId: 't',
    name,
    baseUrl,
    keyCipher: encryptProviderKey('t', name, 'upstream-secret'),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function setup(role: 'admin' | 'member' = 'member') {
  provider('https://api.kimi.com/coding/v1');
  resolvesTo('203.0.113.10');
  membership.mockResolvedValue({ userId: 'u', teamId: 't', role, createdAt: new Date() });
  findConfig.mockResolvedValue(row('c', 'model', { provider: 'kimi', model: 'kimi-for-coding' }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('proxyCompletion', () => {
  it('chooses route and key itself, forwards only inference fields, and strips upstream headers', async () => {
    setup();
    const request = vi.fn(async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'secret' } }));
    const response = await proxyCompletion(
      'u',
      { model: 'c', messages: [{ role: 'user', content: 'Hi' }], stream: true, tools: [], baseURL: 'https://evil.invalid', apiKey: 'client-key' },
      signal(),
      request,
    );
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.kimi.com/coding/v1/chat/completions');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer upstream-secret');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toEqual({ model: 'kimi-for-coding', messages: [{ role: 'user', content: 'Hi' }], stream: true, tools: [] });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('data: [DONE]\n\n');
  });

  it('never contacts upstream for a model that does not exist, or one in a team the caller is not in', async () => {
    setup();
    const request = vi.fn();
    findConfig.mockResolvedValue(null);
    await expect(proxyCompletion('u', { model: 'missing', messages: [{}] }, signal(), request)).rejects.toMatchObject({ status: 403, code: 'model_forbidden' });
    findConfig.mockResolvedValue(row('c', 'model', { provider: 'kimi', model: 'k' }));
    membership.mockResolvedValue(null);
    await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject({ status: 403, code: 'model_forbidden' });
    expect(membership).toHaveBeenLastCalledWith({ where: { userId_teamId: { userId: 'u', teamId: 't' } } });
    expect(request).not.toHaveBeenCalled();
  });

  it('answers an upstream failure with a code, never its body', async () => {
    setup();
    const request = vi.fn(async () => new Response('upstream-secret', { status: 401 }));
    await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });
  });

  it('defaults the configured output cap and refuses a caller exceeding it', async () => {
    setup();
    findConfig.mockResolvedValue(row('c', 'model', { provider: 'kimi', model: 'kimi-for-coding', maxTokens: 2048 }));
    const request = vi.fn(async () => Response.json({ choices: [] }));
    const base = { model: 'c', messages: [{}] };
    await proxyCompletion('u', base, signal(), request);
    expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).max_tokens).toBe(2048);
    for (const fields of [{ max_tokens: 2049 }, { max_completion_tokens: 2049 }, { max_tokens: 0 }, { max_tokens: 1, max_completion_tokens: 1 }]) {
      await expect(proxyCompletion('u', { ...base, ...fields }, signal(), request)).rejects.toMatchObject({ status: 400 });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('resolves a preset to its team model, within the team only', async () => {
    setup();
    findConfig
      .mockResolvedValueOnce(row('p', 'preset', { modelConfigId: 'm' }))
      .mockResolvedValueOnce(row('m', 'model', { provider: 'kimi', model: 'actual', maxTokens: 1024 }));
    const request = vi.fn(async () => Response.json({ choices: [] }));
    await proxyCompletion('u', { model: 'p', messages: [{}] }, signal(), request);
    expect(findConfig).toHaveBeenLastCalledWith({ where: { id: 'm', teamId: 't', kind: 'model' } });
    expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ model: 'actual', max_tokens: 1024 });
  });

  it('calls only the caller’s own team’s provider, with the key sealed for it', async () => {
    setup();
    const request = vi.fn(async () => Response.json({ choices: [] }));
    await proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request);
    expect(findProvider).toHaveBeenCalledWith({ where: { teamId_name: { teamId: 't', name: 'kimi' } } });

    findProvider.mockResolvedValue(null);
    await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject({ code: 'provider_not_configured' });
    provider('https://api.kimi.com/coding/v1');
    vi.stubEnv('PROVIDER_KEYS_SECRET', Buffer.alloc(32, 9).toString('base64'));
    await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject({ code: 'provider_keys_unavailable' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  describe('the address rule', () => {
    /** Calls through a provider at `baseUrl` whose host resolves to `addresses`. */
    const via = async (baseUrl: string, addresses: string[] = [], allowPrivate = false) => {
      setup();
      if (addresses.length) resolvesTo(...addresses);
      if (allowPrivate) vi.stubEnv('ALLOW_PRIVATE_PROVIDERS', 'true');
      provider(baseUrl);
      const request = vi.fn(async () => Response.json({ ok: true }));
      await proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request);
      return (request.mock.calls[0] as unknown as [string])[0];
    };
    const refused = { code: 'provider_address_refused' };

    it('calls a public https host, and refuses one that is private, link-local or carrier-grade NAT', async () => {
      await expect(via('https://api.kimi.com/v1', ['203.0.113.10'])).resolves.toBe('https://api.kimi.com/v1/chat/completions');
      await expect(via('https://internal.example/v1', ['10.0.0.5'])).rejects.toMatchObject(refused);
      await expect(via('https://169.254.169.254/v1')).rejects.toMatchObject(refused);
      await expect(via('https://100.64.0.1/v1')).rejects.toMatchObject(refused);
      await expect(via('https://[::1]/v1')).rejects.toMatchObject(refused);
      await expect(via('https://partly.example/v1', ['203.0.113.10', '127.0.0.1'])).rejects.toMatchObject(refused);
    });

    it('never calls plain http without ALLOW_PRIVATE_PROVIDERS, even to a private host', async () => {
      await expect(via('http://10.0.0.5:11434/v1')).rejects.toMatchObject(refused);
      await expect(via('http://ollama:11434/v1', ['172.18.0.2'])).rejects.toMatchObject(refused);
    });

    it('with it, calls private hosts over either scheme, and plain http only where every address is private', async () => {
      await expect(via('http://10.0.0.5:11434/v1', [], true)).resolves.toBe('http://10.0.0.5:11434/v1/chat/completions');
      await expect(via('http://[::1]:8000/v1', [], true)).resolves.toBe('http://[::1]:8000/v1/chat/completions');
      await expect(via('http://ollama:11434/v1', ['172.18.0.2'], true)).resolves.toBe('http://ollama:11434/v1/chat/completions');
      await expect(via('https://ollama:11434/v1', ['172.18.0.2'], true)).resolves.toBe('https://ollama:11434/v1/chat/completions');
      await expect(via('http://api.kimi.com/v1', ['203.0.113.7'], true)).rejects.toMatchObject(refused);
      await expect(via('http://mixed.example/v1', ['10.0.0.5', '203.0.113.7'], true)).rejects.toMatchObject(refused);
      await expect(via('http://[::ffff:8.8.8.8]/v1', [], true)).rejects.toMatchObject(refused);
    });

    it('refuses a host that does not resolve', async () => {
      setup();
      vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
      const request = vi.fn();
      await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject(refused);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('the connection’s own lookup', () => {
    // What the socket resolves when it opens: an answer that changed since the
    // check — DNS rebinding — must fail here, not connect.
    const answering = (...addresses: string[]) =>
      ((_host: string, _options: object, callback: (e: Error | null, a: unknown) => void) =>
        callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))) as never;
    const run = (protocol: string, resolve: never, all = false) =>
      new Promise<{ error: Error | null; result: unknown }>((done) =>
        guardedLookup(protocol, resolve)('host.example', { all } as never, (error: Error | null, result: unknown) => done({ error, result })),
      );

    it('refuses a host that now resolves somewhere the rule forbids', async () => {
      expect((await run('https:', answering('10.0.0.5'))).error).toBeTruthy();
      expect((await run('https:', answering('203.0.113.10', '169.254.169.254'))).error).toBeTruthy();
      expect((await run('http:', answering('203.0.113.10'))).error).toBeTruthy();
    });

    it('answers in either form the socket asks for when every address passes', async () => {
      expect(await run('https:', answering('203.0.113.10'))).toEqual({ error: null, result: '203.0.113.10' });
      expect((await run('https:', answering('203.0.113.10', '2001:db8::1'), true)).result).toEqual([
        { address: '203.0.113.10', family: 4 },
        { address: '2001:db8::1', family: 6 },
      ]);
      vi.stubEnv('ALLOW_PRIVATE_PROVIDERS', 'true');
      expect((await run('http:', answering('10.0.0.5'))).error).toBeNull();
    });
  });
});

describe('modelCatalog', () => {
  it('reports only stated limits and nothing of the provider response beyond them', async () => {
    setup('admin');
    const request = vi.fn(async () =>
      Response.json({ data: [{ id: 'kimi', display_name: 'Kimi', context_length: 1048576, apiKey: 'secret-key' }, { id: 'other', limit: { context: 128000, output: 8192 } }] }),
    );
    vi.mocked(prisma.teamProvider.findMany).mockResolvedValue([{ name: 'kimi' }] as never);
    expect(await modelCatalog('u', 't', null, signal())).toEqual({ providers: ['kimi'] });
    expect(prisma.teamProvider.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teamId: 't' } }));
    const result = await modelCatalog('u', 't', 'kimi', signal(), request);
    expect(result).toEqual({
      provider: 'kimi',
      models: [
        { id: 'kimi', name: 'Kimi', contextWindow: 1048576, maxTokens: undefined },
        { id: 'other', name: 'other', contextWindow: 128000, maxTokens: 8192 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('is for admins only', async () => {
    setup('member');
    const request = vi.fn();
    await expect(modelCatalog('u', 't', 'kimi', signal(), request)).rejects.toMatchObject({ status: 403, code: 'admin_required' });
    expect(request).not.toHaveBeenCalled();
  });

  it('turns an upstream error, a malformed list or an oversized one into one code', async () => {
    setup('admin');
    for (const response of [
      new Response('secret-key', { status: 401 }),
      Response.json({ data: [{ id: 'bad', context_length: -1 }] }),
      new Response('x'.repeat(1024 * 1024 + 1)),
    ]) {
      await expect(modelCatalog('u', 't', 'kimi', signal(), async () => response)).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });
    }
  });
});
