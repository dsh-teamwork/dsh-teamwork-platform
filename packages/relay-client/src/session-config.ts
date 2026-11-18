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
  agentPreset?: string;
  model?: ModelSelection;
}
const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
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
