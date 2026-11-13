/**
 * The model gateway: a member's DSH talks OpenAI Chat Completions to this
 * server, naming a team configuration id as the model, and the server forwards
 * the call to the provider with a key only it holds.
 *
 * Where a provider lives and its key are the team's (ADR 0006): its admin
 * enters them in the team's console, the key is kept encrypted (`provider-keys.ts`), and
 * where the address may point is `provider-network.ts`'s rule. Nothing a
 * caller sends can name a URL, a header or a credential.
 */

import 'server-only';

import type { ModelCatalog } from '@dsh-teamwork/shared';
import { z } from 'zod';

import { readJson } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { decryptProviderKey } from '@/lib/provider-keys';
import { checkProviderAddress, providerFetch, type ProviderRequest } from '@/lib/provider-network';
import { requireMembership, TeamError } from '@/lib/team';

/**
 * A team provider's base URL and key, or `provider_not_configured` when the
 * team has none by that name. The address is checked against the network rule
 * here, and again by `providerFetch` as it connects.
 */
async function routeFor(teamId: string, provider: string): Promise<{ url: string; key: string }> {
  const row = await prisma.teamProvider.findUnique({ where: { teamId_name: { teamId, name: provider } } });
  if (!row) throw new TeamError(503, 'provider_not_configured');
  const url = new URL(row.baseUrl);
  await checkProviderAddress(url);
  return { url: url.href.replace(/\/$/, ''), key: decryptProviderKey(teamId, row.name, row.keyCipher) };
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
 * For an admin choosing team models: one provider's `/models`. A limit the
 * provider does not report stays absent — never a guessed capability.
 */
export async function modelCatalog(
  userId: string,
  teamId: string,
  provider: string,
  signal: AbortSignal,
  request: ProviderRequest = providerFetch,
): Promise<ModelCatalog> {
  const admin = await requireMembership(userId, teamId, true);
  const route = await routeFor(admin.teamId, provider);
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

/**
 * The team a configuration id belongs to and the provider and model it
 * resolves to. A person may be in several teams (ADR 0013), so the id names the
 * team: the caller must be a member of that team, and everything after this —
 * the referenced model, the provider, its key — is read within it. A config
 * that does not exist and one in a team the caller is not in get the same
 * answer.
 */
async function resolveModel(userId: string, configId: string) {
  const config = await prisma.teamConfig.findFirst({ where: { id: configId, kind: { in: ['model', 'preset'] } } });
  if (!config) throw new TeamError(403, 'model_forbidden');
  const { teamId } = config;
  if (!(await prisma.membership.findUnique({ where: { userId_teamId: { userId, teamId } } }))) throw new TeamError(403, 'model_forbidden');
  const referenced = (config.data as { modelConfigId?: unknown }).modelConfigId;
  if (config.kind === 'preset' && typeof referenced === 'string') {
    const model = await prisma.teamConfig.findFirst({ where: { id: referenced, teamId, kind: 'model' } });
    if (!model) throw new TeamError(403, 'model_forbidden');
    return { teamId, ...RouteData.parse(model.data) };
  }
  return { teamId, ...RouteData.parse(config.data) };
}

export async function proxyCompletion(userId: string, input: unknown, signal: AbortSignal, request: ProviderRequest = providerFetch): Promise<Response> {
  const body = CompletionRequest.parse(input);
  const target = await resolveModel(userId, body.model);

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

  const route = await routeFor(target.teamId, target.provider);
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
