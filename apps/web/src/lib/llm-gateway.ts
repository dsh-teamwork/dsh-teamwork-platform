/**
 * The model gateway: a member's DSH talks OpenAI Chat Completions to this
 * server, naming a team configuration id as the model, and the server forwards
 * the call to the provider with a key only it holds.
 *
 * Where a provider lives and which variable holds its key is the deployment's
 * decision (`LLM_ROUTES_JSON`); nothing a caller sends can name a URL, a
 * header or a credential.
 */

import 'server-only';

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

import { readJson } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { requireMembership, TeamError } from '@/lib/team';

const RoutesSchema = z.record(
  z.string(),
  z.strictObject({ baseURL: z.url(), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
);

function routes() {
  return RoutesSchema.parse(JSON.parse(process.env.LLM_ROUTES_JSON || '{}'));
}

/** Loopback and private networks: where a self-hosted model lives (RFC 1918, RFC 4193). */
const PRIVATE_NETWORKS = new BlockList();
PRIVATE_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_NETWORKS.addAddress('::1', 'ipv6');
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6');

function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return PRIVATE_NETWORKS.check(mapped, 'ipv4');
  const family = isIP(address);
  return family !== 0 && PRIVATE_NETWORKS.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Plain http only where every address the host resolves to is private, so a
 * team can use a model it serves itself (Ollama, vLLM) while a public host
 * still needs https. The host is the operator's own `LLM_ROUTES_JSON`, never a
 * caller's, so the check guards against a misconfigured route sending the key
 * in clear text across the internet, not against an attacker choosing the host.
 */
async function plainHttpAllowed(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((a) => isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * A provider's base URL and key, or `provider_not_configured`: https, or http to
 * a private network, and nothing smuggled into the URL.
 */
export async function routeFor(provider: string): Promise<{ url: string; key: string }> {
  const route = routes()[provider];
  if (!route) throw new TeamError(503, 'provider_not_configured');
  const url = new URL(route.baseURL);
  if (url.username || url.password || url.search || url.hash) throw new TeamError(503, 'provider_not_configured');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (await plainHttpAllowed(url.hostname)))) {
    throw new TeamError(503, 'provider_not_configured');
  }
  const key = process.env[route.apiKeyEnv];
  if (!key) throw new TeamError(503, 'provider_not_configured');
  return { url: url.href.replace(/\/$/, ''), key };
}

const limit = z.number().int().positive().max(10_000_000);
const CatalogItem = z.object({
  id: z.string().min(1).max(100),
  display_name: z.string().max(200).optional(),
  context_length: limit.optional(),
  context_window: limit.optional(),
  max_output_tokens: limit.optional(),
  max_completion_tokens: limit.optional(),
  limit: z.object({ context: limit.optional(), output: limit.optional() }).optional(),
});

/**
 * For an admin choosing a team model: the configured providers, or one
 * provider's `/models`. A limit the provider does not report stays absent —
 * never a guessed capability.
 */
export async function modelCatalog(userId: string, provider: string | null, signal: AbortSignal, request: typeof fetch = fetch) {
  await requireMembership(userId, true);
  if (!provider) return { providers: Object.keys(routes()) };
  const route = await routeFor(provider);
  let list: z.infer<typeof CatalogItem>[];
  try {
    const response = await request(`${route.url}/models`, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${route.key}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    list = z.object({ data: z.array(CatalogItem).max(2000) }).parse(await readJson(response, 1024 * 1024)).data;
  } catch {
    throw new TeamError(502, 'upstream_unavailable');
  }
  const models = new Map(
    list.map((m) => [
      m.id,
      {
        id: m.id,
        name: m.display_name ?? m.id,
        contextWindow: m.context_length ?? m.context_window ?? m.limit?.context,
        maxTokens: m.max_output_tokens ?? m.max_completion_tokens ?? m.limit?.output,
      },
    ]),
  );
  return { provider, models: [...models.values()] };
}

/** The request fields forwarded upstream. Everything else a caller sends is dropped. */
const FORWARDED = [
  'messages',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'stop',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'reasoning_effort',
] as const;

const CompletionRequest = z.looseObject({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().optional(),
});

const RouteData = z.object({ provider: z.string(), model: z.string(), maxTokens: z.number().int().positive().optional() });

/** The provider and model a configuration id resolves to, within the caller's team only. */
async function resolveModel(teamId: string, configId: string) {
  const config = await prisma.teamConfig.findFirst({ where: { id: configId, teamId, kind: { in: ['model', 'preset'] } } });
  if (!config) throw new TeamError(403, 'model_forbidden');
  const referenced = (config.data as { modelConfigId?: unknown }).modelConfigId;
  if (config.kind === 'preset' && typeof referenced === 'string') {
    const model = await prisma.teamConfig.findFirst({ where: { id: referenced, teamId, kind: 'model' } });
    if (!model) throw new TeamError(403, 'model_forbidden');
    return RouteData.parse(model.data);
  }
  return RouteData.parse(config.data);
}

export async function proxyCompletion(userId: string, input: unknown, signal: AbortSignal, request: typeof fetch = fetch): Promise<Response> {
  const body = CompletionRequest.parse(input);
  const member = await requireMembership(userId);
  const target = await resolveModel(member.teamId, body.model);

  if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
    throw new TeamError(400, 'max_tokens_exceeds_context');
  }
  for (const field of ['max_tokens', 'max_completion_tokens'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (target.maxTokens && (value as number) > target.maxTokens)) {
      throw new TeamError(400, 'max_tokens_exceeds_context');
    }
  }
  if (target.maxTokens && body.max_tokens === undefined && body.max_completion_tokens === undefined) {
    body.max_tokens = target.maxTokens;
  }

  const route = await routeFor(target.provider);
  const payload = Object.fromEntries(FORWARDED.filter((key) => key in body).map((key) => [key, body[key]]));
  let upstream: Response;
  try {
    upstream = await request(`${route.url}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${route.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, model: target.model }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
  } catch {
    throw new TeamError(502, 'upstream_unavailable');
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw upstream.status === 429 ? new TeamError(429, 'upstream_rate_limited') : new TeamError(502, 'upstream_unavailable');
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!(body.stream ? contentType.includes('text/event-stream') : contentType.includes('application/json'))) {
    await upstream.body?.cancel();
    throw new TeamError(502, 'upstream_unavailable');
  }
  // Upstream headers (cookies, request ids, rate-limit detail) are not passed on.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': body.stream ? 'text/event-stream' : 'application/json',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
