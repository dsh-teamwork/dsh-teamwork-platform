/**
 * The providers an admin picks from instead of typing an address: each one
 * serves the OpenAI-compatible API the gateway speaks (`/chat/completions`,
 * `/models`, a Bearer key), at the address in its own documentation. Picking
 * one fills the provider's name and base URL; the admin pastes only the key,
 * and the address still passes the network rule on save and on every call
 * (server/internal/team/network.go). A provider that is not listed is added by hand.
 *
 * Anthropic and Gemini are left out on purpose: their OpenAI-compatible layers
 * are partial. A team reaches them through OpenRouter or a custom address.
 *
 * Each entry's display name is `team.catalog.<id>` in the messages, since some
 * are written differently in Chinese.
 */

export interface CatalogProvider {
  /** The provider's name in the team, unless the admin renames it to add a second account. */
  id: string;
  baseUrl: string;
  /** Two letters for its tile; no provider's logo is drawn. */
  mark: string;
}

export const PROVIDER_CATALOG: readonly CatalogProvider[] = [
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', mark: 'DS' },
  { id: 'openai', baseUrl: 'https://api.openai.com/v1', mark: 'OA' },
  { id: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', mark: 'QW' },
  { id: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', mark: 'KM' },
  { id: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', mark: 'GL' },
  { id: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', mark: 'DB' },
  { id: 'minimax', baseUrl: 'https://api.minimaxi.com/v1', mark: 'MM' },
  { id: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', mark: 'SF' },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', mark: 'OR' },
];

/** The catalog entry a stored provider came from, matched by address: a renamed second account still shows its maker. */
export function catalogEntry(baseUrl: string): CatalogProvider | undefined {
  const normal = (url: string) => url.replace(/\/+$/, '');
  return PROVIDER_CATALOG.find((p) => normal(p.baseUrl) === normal(baseUrl));
}
