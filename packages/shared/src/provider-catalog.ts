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
 * Anthropic API, keep their own OpenAI-compatible address. The mainland
 * (`-cn`) account is the one listed where Models.dev has two; the other is a
 * custom address away.
 *
 * Anthropic and Gemini are left out on purpose: their OpenAI-compatible layers
 * are partial. A team reaches them through OpenRouter or a custom address.
 *
 * In the team console each entry's display name is `team.catalog.<id>` in its
 * messages, since some are written differently in Chinese; its tile is its
 * mark (`providerMark` of its id). It lives here so that every console which
 * adds a provider (the team's, and an edition's own) offers the same list and
 * reads Models.dev under the same names.
 */

export interface CatalogProvider {
  /** Models.dev's provider id, and the provider's name in the team unless the admin renames it to add a second account. */
  id: string;
  baseUrl: string;
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = [
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com' },
  // Models.dev states no address for OpenAI.
  { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'alibaba-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'moonshotai-cn', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipuai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  // Models.dev's address for MiniMax is its Anthropic API; this is its OpenAI-compatible one.
  { id: 'minimax-cn', baseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'siliconflow-cn', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
];

/** The catalog entry a stored provider came from, matched by address: a renamed second account still reads Models.dev under its id. */
export function catalogEntry(baseUrl: string): CatalogProvider | undefined {
  const normal = (url: string) => url.replace(/\/+$/, '');
  return PROVIDER_CATALOG.find((p) => normal(p.baseUrl) === normal(baseUrl));
}
