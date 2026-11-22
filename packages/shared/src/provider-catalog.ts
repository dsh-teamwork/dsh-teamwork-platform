/**
 * The providers an admin picks from instead of typing an address: each one
 * serves the OpenAI-compatible API the gateway speaks (`/chat/completions`,
 * `/models`, a Bearer key). Picking one fills the provider's name and base
 * URL; the admin pastes only the key, and the address still passes the network
 * rule on save and on every call (server/internal/team/network.go). A provider
 * that is not listed is added by hand.
 *
 * Each entry is Models.dev's provider of that id (https://models.dev/api.json),
 * at the `api` address Models.dev states for it, so a team's provider is named
 * as Models.dev names it and its models' limits and prices are read there
 * under that name. The exceptions are said where they are: OpenAI, for which
 * Models.dev states no address, and MiniMax, whose address there is its
 * Anthropic API, keep their own OpenAI-compatible address.
 *
 * A maker with several offerings lists each as its own entry under one
 * `vendor`: mainland and international accounts, and a subscription plan
 * beside metered billing. They are separate Models.dev providers with their
 * own model ids and prices (a plan's are zero: its calls are paid for by the
 * subscription), so the console offers them as one tile with a choice, and
 * a team's provider keeps the entry's id as its name. A maker with one
 * offering lists its mainland account; the other is a custom address away.
 *
 * Anthropic and Gemini are left out on purpose: their OpenAI-compatible layers
 * are partial. A team reaches them through OpenRouter or a custom address.
 *
 * In the team console each vendor's display name is `team.catalog.<vendor>`
 * in its messages, since some are written differently in Chinese, and a
 * plan's product name is `team.catalogPlans.<vendor>`; its tile is its mark
 * (`providerMark` of its id). It lives here so that every console which adds
 * a provider (the team's, and an edition's own) offers the same list and reads
 * Models.dev under the same names.
 */

export interface CatalogProvider {
  /** Models.dev's provider id, and the provider's name in the team unless the admin renames it to add a second account. */
  id: string;
  baseUrl: string;
  /** The maker's tile this entry is offered under; one tile holds every offering of one maker. */
  vendor: string;
  /** Where the account is held: on the mainland service or the international one. */
  region: 'cn' | 'global';
  /** `plan` is a subscription (Coding Plan, Token Plan): its calls cost nothing per token. */
  billing: 'metered' | 'plan';
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = [
  { id: 'deepseek', vendor: 'deepseek', region: 'cn', billing: 'metered', baseUrl: 'https://api.deepseek.com' },
  // Models.dev states no address for OpenAI.
  { id: 'openai', vendor: 'openai', region: 'global', billing: 'metered', baseUrl: 'https://api.openai.com/v1' },
  { id: 'alibaba-cn', vendor: 'alibaba', region: 'cn', billing: 'metered', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'moonshotai-cn', vendor: 'kimi', region: 'cn', billing: 'metered', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'moonshotai', vendor: 'kimi', region: 'global', billing: 'metered', baseUrl: 'https://api.moonshot.ai/v1' },
  { id: 'kimi-code-plan-cn', vendor: 'kimi', region: 'cn', billing: 'plan', baseUrl: 'https://api.kimi.com/coding/v1' },
  { id: 'kimi-code-plan-global', vendor: 'kimi', region: 'global', billing: 'plan', baseUrl: 'https://api.kimi.ai/coding/v1' },
  { id: 'zhipuai', vendor: 'zhipuai', region: 'cn', billing: 'metered', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'volcengine', vendor: 'volcengine', region: 'cn', billing: 'metered', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  // Models.dev's address for MiniMax is its Anthropic API; these are its OpenAI-compatible ones. A plan shares its
  // region's address, so only the provider's name tells the two apart (catalogEntry).
  { id: 'minimax-cn', vendor: 'minimax', region: 'cn', billing: 'metered', baseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'minimax', vendor: 'minimax', region: 'global', billing: 'metered', baseUrl: 'https://api.minimax.io/v1' },
  { id: 'minimax-cn-coding-plan', vendor: 'minimax', region: 'cn', billing: 'plan', baseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'minimax-coding-plan', vendor: 'minimax', region: 'global', billing: 'plan', baseUrl: 'https://api.minimax.io/v1' },
  { id: 'siliconflow-cn', vendor: 'siliconflow', region: 'cn', billing: 'metered', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'openrouter', vendor: 'openrouter', region: 'global', billing: 'metered', baseUrl: 'https://openrouter.ai/api/v1' },
];

/** Each maker's offerings, in the catalog's order: one tile apiece. */
export function catalogVendors(): { vendor: string; offerings: CatalogProvider[] }[] {
  const vendors = new Map<string, CatalogProvider[]>();
  for (const p of PROVIDER_CATALOG) vendors.set(p.vendor, [...(vendors.get(p.vendor) ?? []), p]);
  return [...vendors].map(([vendor, offerings]) => ({ vendor, offerings }));
}

/**
 * The catalog entry a stored provider came from: the one it is named after,
 * else the first at its address, so a renamed second account still reads
 * Models.dev under its entry. A plan that shares its address with metered
 * billing is told apart only by its name; renamed, it reads as metered.
 */
export function catalogEntry(provider: { name: string; baseUrl: string }): CatalogProvider | undefined {
  const normal = (url: string) => url.replace(/\/+$/, '');
  return PROVIDER_CATALOG.find((p) => p.id === provider.name) ?? PROVIDER_CATALOG.find((p) => normal(p.baseUrl) === normal(provider.baseUrl));
}
