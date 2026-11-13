/**
 * The team API's wire shapes: what the console and the DSH plugin send, and
 * what the web API answers. The server parses every write with these; the
 * console builds its forms from the same types.
 */

import { z } from 'zod';

/**
 * A failure the team API names, each one a stable code a client branches on
 * and words in its own language (`teamErrors.*` in the web app's messages).
 */
export const TEAM_ERRORS = [
  'team_not_found',
  'admin_required',
  'already_in_team',
  'admin_cannot_leave',
  'cannot_remove_self',
  'invite_invalid',
  'invite_used',
  'config_conflict',
  'config_exists',
  'model_not_found',
  'plugin_dependency_invalid',
  'max_tokens_exceeds_context',
  'model_forbidden',
  'provider_not_configured',
  'upstream_unavailable',
  'upstream_rate_limited',
  'payload_too_large',
  'passwords_off',
  'member_in_team',
  'not_a_member',
  'cannot_reset_self',
  'member_in_other_team',
  'provider_exists',
  'provider_in_use',
  'model_in_use',
  'plugin_in_use',
  'provider_address_refused',
  'provider_keys_unavailable',
] as const;
export type TeamErrorCode = (typeof TEAM_ERRORS)[number];

const name = z.string().trim().min(1).max(100);
const tokens = z.number().int().min(1).max(10_000_000);
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
const toolList = z.array(z.string().trim().min(1).max(100)).max(50).default([]);

/** A provider's model, addressed the way the provider names it. */
const ModelRoute = { provider: name, model: name, contextWindow: tokens.optional(), maxTokens: tokens.optional() };

export const ModelDataSchema = z.strictObject(ModelRoute);

/**
 * A preset either references a team model (`modelConfigId`) or carries a
 * whole provider/model pair of its own — never a mix of the two.
 */
export const PresetDataSchema = z
  .strictObject({
    provider: name.optional(),
    model: name.optional(),
    contextWindow: tokens.optional(),
    maxTokens: tokens.optional(),
    modelConfigId: z.string().min(1).max(100).optional(),
    description: z.string().max(500).default(''),
    instructions: z.string().max(4000).default(''),
    outputDescription: z.string().max(2000).default(''),
    pluginDependencies: z
      .array(z.strictObject({ pluginConfigId: z.string().min(1).max(100), version: semver }))
      .max(30)
      .default([]),
    requiredTools: toolList,
    optionalTools: toolList,
    systemPrompt: z.string().max(20_000).default(''),
  })
  .superRefine((data, ctx) => {
    const ownRoute = [data.provider, data.model, data.contextWindow, data.maxTokens].some((v) => v !== undefined);
    if (data.modelConfigId ? ownRoute : !data.provider || !data.model) {
      ctx.addIssue({ code: 'custom', message: 'A preset references a team model or names its own provider and model, not both.' });
    }
    if (new Set(data.pluginDependencies.map((d) => d.pluginConfigId)).size !== data.pluginDependencies.length) {
      ctx.addIssue({ code: 'custom', path: ['pluginDependencies'], message: 'A plugin is listed twice.' });
    }
    const tools = [...data.requiredTools, ...data.optionalTools];
    if (new Set(tools).size !== tools.length) {
      ctx.addIssue({ code: 'custom', path: ['requiredTools'], message: 'A tool is listed twice.' });
    }
  });

/** A plugin pinned by the team: an npm package at one exact version. Installing it stays the member's decision. */
export const PluginDataSchema = z.strictObject({
  package: z.string().regex(/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/),
  version: semver,
  providesTools: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  description: z.string().max(1000).default(''),
});

export const ConfigInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('model'), name, data: ModelDataSchema }),
  z.object({ kind: z.literal('preset'), name, data: PresetDataSchema }),
  z.object({ kind: z.literal('plugin'), name, data: PluginDataSchema }),
]);
export type ConfigInput = z.infer<typeof ConfigInputSchema>;
export type ConfigKind = ConfigInput['kind'];
export type ModelData = z.infer<typeof ModelDataSchema>;
export type PresetData = z.infer<typeof PresetDataSchema>;
export type PluginData = z.infer<typeof PluginDataSchema>;

/** An edit names the version it was made against; a stale one is `config_conflict`. */
export const UpdateConfigSchema = z.intersection(ConfigInputSchema, z.object({ version: z.number().int().positive() }));

/** A stored configuration as the API answers it. `data` is the kind's shape. */
export type TeamConfigView = ConfigInput & { id: string; version: number; updatedAt: string };

export type TeamRole = 'admin' | 'member';

/** One team in the plugin's snapshot: its name, the caller's role in it and its configuration. */
export interface TeamSnapshot {
  teamId: string;
  teamName: string;
  role: TeamRole;
  configs: TeamConfigView[];
}

/** `GET /api/configs` — what the plugin syncs: every team the caller is in (ADR 0013). */
export interface ConfigSnapshot {
  teams: TeamSnapshot[];
}

/** `GET /api/teams` — one team the caller is in, for the list they pick from. */
export interface TeamSummary {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
}

export const CreateTeamSchema = z.object({ name });
export const RedeemInviteSchema = z.object({ token: z.string().min(32).max(100) });

export interface TeamMemberView {
  userId: string;
  email: string;
  role: TeamRole;
}

/** `GET /api/teams/:teamId` — a team the caller is in, their role in it and who else is in it. */
export interface TeamView {
  id: string;
  name: string;
  role: TeamRole;
  members: TeamMemberView[];
}

export interface InviteView {
  id: string;
  expiresAt: string;
  usedAt: string | null;
}

/** `POST /api/teams/:teamId/invites` — the only time the token itself is seen. */
export interface CreatedInvite extends InviteView {
  token: string;
}

/**
 * A team's provider as an admin enters it (ADR 0006). The address is an
 * OpenAI-compatible base URL with nothing hidden in it; where it may point is
 * the gateway's network rule, checked again on every call. The key is
 * write-only: it is never in an answer.
 */
const baseUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, 'A base URL carries no credentials, query or fragment');
const apiKey = z.string().trim().min(1).max(4096);
export const ProviderInputSchema = z.object({ name, baseUrl, apiKey });
/** An edit keeps the name, which team models refer to; a key left out stays as it was. */
export const ProviderUpdateSchema = z.object({ baseUrl, apiKey: apiKey.optional() });

/** `GET /api/teams/:teamId/providers` — never the key. */
export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  updatedAt: string;
}

/** `POST /api/teams/:teamId/members`: an admin adds someone by email, where the instance holds passwords. */
export const AddMemberSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

/**
 * The added member, with the first password the only time it is seen — or
 * null when the address already had an account, whose own password stands.
 */
export interface AddedMember {
  userId: string;
  email: string;
  password: string | null;
}

/** `POST /api/teams/:teamId/members/:userId/password`: a new first password, seen once. */
export interface ResetPassword {
  password: string;
}

/** `GET /api/teams/:teamId/model-catalog?provider=`: one provider's models. */
export interface ModelCatalog {
  provider: string;
  models: { id: string; name: string; contextWindow?: number; maxTokens?: number }[];
}
