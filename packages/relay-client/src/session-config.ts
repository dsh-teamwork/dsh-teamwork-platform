/** Desktop-owned session configuration. Paths and native ids are preserved exactly. */
import { z } from 'zod';
import { directoryName } from './dsh';

export const ModelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export interface SessionOptions {
  cwd?: string;
  /**
   * The team a new session is started for: it lands in that team's default workspace on the computer
   * (`teamDirectories`) unless `cwd` names another folder.
   */
  teamId?: string;
  agentPreset?: string;
  model?: ModelSelection;
}
const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The team preset's avatar id (`@dsh-teamwork/shared`, avatars.ts); a DSH's own preset, or an older plugin, sends none. */
  avatar: z.string().optional(),
  description: z.string(),
  isDefault: z.boolean(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  version: z.number().optional(),
  model: ModelSelectionSchema.optional(),
  blocked: z.string().nullable(),
  tools: z.array(z.object({ name: z.string(), required: z.boolean(), state: z.string() })),
  dependencies: z.array(z.object({ name: z.string(), version: z.string(), state: z.string() })),
});
const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  reasoning: z
    .object({ efforts: z.array(z.object({ id: z.string(), name: z.string() })), defaultEffort: z.string().optional() })
    .optional(),
});
const CatalogSchema = z.object({
  default: ModelSelectionSchema,
  groups: z.array(z.object({ id: z.string(), name: z.string(), models: ModelSchema.array() })),
  failures: z.array(z.object({ name: z.string() })).default([]),
});
const ConfigurationSchema = z.object({
  presets: PresetSchema.array(),
  /** Where the computer lets a session start: where DSH was started, then its workspaces. Older plugins send none. */
  directories: z.string().array().default([]),
  /** Each team's default workspace on the computer, by team id, always one of `directories`. Older plugins send none. */
  teamDirectories: z.record(z.string(), z.string()).default({}),
  /**
   * DSH's permission presets (read-only, workspace write, full access…), the session's current one and the default
   * (the plugin's `src/phone-permission.ts`). A `risky` one leaves the workspace's sandbox or skips approval, and a
   * client confirms it once; one not `allowed` (risky, on a shared DSH) is shown and cannot be picked. Null where DSH
   * composes no presets, or from an older plugin.
   */
  permissions: z
    .object({
      current: z.string().nullable(),
      defaultPreset: z.string(),
      options: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), risky: z.boolean(), allowed: z.boolean() })),
    })
    .nullable()
    .default(null),
  current: z
    .object({
      sessionId: z.string(),
      cwd: z.string(),
      agentPreset: z.string().nullable(),
      model: ModelSelectionSchema.nullable(),
      started: z.boolean(),
      running: z.boolean(),
    })
    .nullable(),
});

export function directoriesOf(value: unknown): { path: string; name: string }[] {
  const parsed = z
    .object({ items: z.array(z.object({ cwd: z.string().optional(), updatedAt: z.number().optional() })) })
    .parse(value);
  const paths = new Set<string>();
  return parsed.items
    .slice()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .flatMap((item) => {
      if (!item.cwd || paths.has(item.cwd)) return [];
      paths.add(item.cwd);
      return [{ path: item.cwd, name: directoryName(item.cwd) || item.cwd }];
    });
}
/**
 * The folders a new session can start in: those of the reader's own sessions, newest first, then the ones the
 * computer offers. A member new to a shared DSH, or a computer with no session yet, has only the second.
 */
export function startableDirectories(sessions: unknown, offered: readonly string[]) {
  const known = directoriesOf(sessions);
  const seen = new Set(known.map((item) => item.path));
  return [...known, ...offered.filter((path) => !seen.has(path)).map((path) => ({ path, name: directoryName(path) || path }))];
}

/**
 * Where a new session starts when its member names no folder: the team's default workspace on the computer, else the
 * folder of the reader's latest session, else the first the computer offers. `startable` is `startableDirectories`.
 */
export function defaultDirectory(
  startable: readonly { path: string }[],
  teamDirectories: Readonly<Record<string, string>>,
  teamId?: string,
): string | undefined {
  const team = teamId ? teamDirectories[teamId] : undefined;
  return team && startable.some((item) => item.path === team) ? team : startable[0]?.path;
}

export function configurationOf(sessions: unknown, models: unknown, configuration: unknown) {
  const catalog = CatalogSchema.parse(models);
  const parsed = ConfigurationSchema.parse(configuration);
  return {
    ...parsed,
    directories: startableDirectories(sessions, parsed.directories),
    defaultModel: catalog.default,
    models: catalog.groups.flatMap((group) =>
      group.models.map((model) => ({ ...model, provider: group.id, providerName: group.name })),
    ),
    modelFailures: catalog.failures.map((failure) => failure.name),
  };
}
export type SessionConfiguration = ReturnType<typeof configurationOf>;
