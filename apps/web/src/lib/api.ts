import type { components, paths } from './api.gen';

/**
 * The console's calls to the server's API. A failure is an ApiError carrying
 * the stable code the server answered with, which a page words in its own
 * language; it never parses a sentence.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly scope?: string,
    readonly resetAt?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function checkResponse(response: Response) {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: unknown; scope?: unknown; resetAt?: unknown } | null;
    throw new ApiError(response.status, typeof error?.error === 'string' ? error.error : 'unavailable',
      typeof error?.scope === 'string' ? error.scope : undefined,
      typeof error?.resetAt === 'string' && !Number.isNaN(Date.parse(error.resetAt)) ? error.resetAt : undefined);
  }
}

export async function download(path: string, filename: string) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin' });
  await checkResponse(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  await checkResponse(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** The shapes api/openapi.yaml names, generated into api.gen.ts (`pnpm api:types`). */
export type Schemas = components['schemas'];
export type Session = Schemas['Session'];
export type PluginCode = Schemas['PluginCode'];

export type Team = Schemas['Team'];
export type TeamSummary = paths['/teams']['get']['responses'][200]['content']['application/json'][number];
export type Provider = Schemas['Provider'];
export type Invite = Schemas['Invite'];

/**
 * A configuration with its kind's data, as the server stores it: it fills a
 * preset's and a plugin's lists and texts, so they are never absent here
 * though a writer may leave them out.
 */
type ConfigData = {
  model: Schemas['ModelData'];
  preset: Schemas['PresetData'] &
    Required<Pick<Schemas['PresetData'], 'description' | 'instructions' | 'outputDescription' | 'pluginDependencies' | 'requiredTools' | 'optionalTools' | 'systemPrompt'>>;
  plugin: Schemas['PluginData'] & Required<Pick<Schemas['PluginData'], 'providesTools' | 'description'>>;
};
export type ConfigOf<K extends keyof ConfigData> = Omit<Schemas['Config'], 'kind' | 'data'> & { kind: K; data: ConfigData[K] };
export type TeamConfig = ConfigOf<'model'> | ConfigOf<'preset'> | ConfigOf<'plugin'>;

/** Raw private artifact upload; the server derives the package identity and digest. */
export async function uploadArtifact<T>(teamId:string,file:File):Promise<T>{
 const response=await fetch(`/api/teams/${encodeURIComponent(teamId)}/artifacts`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file});
 await checkResponse(response);return response.json() as Promise<T>;
}
