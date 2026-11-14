/**
 * The console's calls to the server's API. A failure is an ApiError carrying
 * the stable code the server answered with, which a page words in its own
 * language; it never parses a sentence.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiError(response.status, typeof error?.error === 'string' ? error.error : 'unavailable');
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** GET /api/auth/session. */
export interface Session {
  user: { id: string; email: string | null; name: string | null; mustChangePassword: boolean } | null;
  doors: { password: boolean; emailCode: boolean; google: boolean };
  setupOpen: boolean;
  mobileRedirectPrefix: string;
}

/** POST /api/auth/plugin/code. */
export interface PluginCode {
  code: string;
  returnTo: { url: string; to: 'dsh' | 'app' } | null;
}
