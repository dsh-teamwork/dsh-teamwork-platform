/**
 * The gateway's security boundary, with Prisma stubbed: the server alone
 * chooses where a call goes and with which key, only a team's own
 * configuration can be named, and nothing from upstream leaks back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// The strategy is next-auth, which needs a Next runtime; nothing here signs in.
vi.mock('@/lib/auth/strategy', () => ({ strategy: { identity: async () => null } }));
vi.mock('@/lib/prisma', () => ({ prisma: { membership: { findUnique: vi.fn() }, teamConfig: { findFirst: vi.fn() } } }));
// Where a plain-http provider's host resolves decides whether it may be called.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const { prisma } = await import('@/lib/prisma');
const { lookup } = await import('node:dns/promises');
const { modelCatalog, proxyCompletion } = await import('../llm-gateway');

const membership = vi.mocked(prisma.membership.findUnique);
const findConfig = vi.mocked(prisma.teamConfig.findFirst);
const signal = () => new AbortController().signal;
const row = (id: string, kind: 'model' | 'preset', data: object) =>
  ({ id, teamId: 't', kind, name: id, data, version: 1, createdAt: new Date(), updatedAt: new Date() }) as never;

function setup(role: 'admin' | 'member' = 'member') {
  vi.stubEnv('LLM_ROUTES_JSON', JSON.stringify({ kimi: { baseURL: 'https://api.kimi.com/coding/v1', apiKeyEnv: 'TEST_MODEL_KEY' } }));
  vi.stubEnv('TEST_MODEL_KEY', 'upstream-secret');
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

  it('never contacts upstream for a foreign model or a caller in no team', async () => {
    setup();
    const request = vi.fn();
    findConfig.mockResolvedValue(null);
    await expect(proxyCompletion('u', { model: 'foreign', messages: [{}] }, signal(), request)).rejects.toMatchObject({ status: 403, code: 'model_forbidden' });
    expect(findConfig).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ teamId: 't', id: 'foreign' }) }));
    membership.mockResolvedValue(null);
    await expect(proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request)).rejects.toMatchObject({ status: 403, code: 'no_team' });
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

  describe('a plain-http provider', () => {
    const resolvesTo = (...addresses: string[]) =>
      vi.mocked(lookup).mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never);
    const via = async (baseURL: string) => {
      setup();
      vi.stubEnv('LLM_ROUTES_JSON', JSON.stringify({ kimi: { baseURL, apiKeyEnv: 'TEST_MODEL_KEY' } }));
      const request = vi.fn(async () => Response.json({ ok: true }));
      await proxyCompletion('u', { model: 'c', messages: [{}] }, signal(), request);
      return (request.mock.calls[0] as unknown as [string])[0];
    };

    it('is called when its host is a private address', async () => {
      await expect(via('http://10.0.0.5:11434/v1')).resolves.toBe('http://10.0.0.5:11434/v1/chat/completions');
      await expect(via('http://[::1]:8000/v1')).resolves.toBe('http://[::1]:8000/v1/chat/completions');
      expect(lookup).not.toHaveBeenCalled();
    });

    it('is called when every address its name resolves to is private, as a compose service is', async () => {
      resolvesTo('172.18.0.2');
      await expect(via('http://ollama:11434/v1')).resolves.toBe('http://ollama:11434/v1/chat/completions');
      resolvesTo('127.0.0.1', '::1');
      await expect(via('http://localhost:8000/v1')).resolves.toBe('http://localhost:8000/v1/chat/completions');
    });

    it('is refused when its host is public, partly public, or does not resolve', async () => {
      resolvesTo('203.0.113.7');
      await expect(via('http://api.kimi.com/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
      resolvesTo('10.0.0.5', '203.0.113.7');
      await expect(via('http://mixed.example/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
      vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
      await expect(via('http://missing.example/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
      await expect(via('http://203.0.113.7/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
      await expect(via('http://[::ffff:8.8.8.8]/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
    });

    it('keeps refusing credentials, a query or another scheme in the route', async () => {
      await expect(via('http://user:pass@10.0.0.5/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
      await expect(via('http://10.0.0.5/v1?key=x')).rejects.toMatchObject({ code: 'provider_not_configured' });
      await expect(via('ftp://10.0.0.5/v1')).rejects.toMatchObject({ code: 'provider_not_configured' });
    });
  });
});

describe('modelCatalog', () => {
  it('reports only stated limits and nothing of the provider response beyond them', async () => {
    setup('admin');
    const request = vi.fn(async () =>
      Response.json({ data: [{ id: 'kimi', display_name: 'Kimi', context_length: 1048576, apiKey: 'secret-key' }, { id: 'other', limit: { context: 128000, output: 8192 } }] }),
    );
    expect(await modelCatalog('u', null, signal())).toEqual({ providers: ['kimi'] });
    const result = await modelCatalog('u', 'kimi', signal(), request);
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
    await expect(modelCatalog('u', 'kimi', signal(), request)).rejects.toMatchObject({ status: 403, code: 'admin_required' });
    expect(request).not.toHaveBeenCalled();
  });

  it('turns an upstream error, a malformed list or an oversized one into one code', async () => {
    setup('admin');
    for (const response of [
      new Response('secret-key', { status: 401 }),
      Response.json({ data: [{ id: 'bad', context_length: -1 }] }),
      new Response('x'.repeat(1024 * 1024 + 1)),
    ]) {
      await expect(modelCatalog('u', 'kimi', signal(), async () => response)).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });
    }
  });
});
