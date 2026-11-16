import { adminPath } from './base';
/**
 * The browser's client for /api/admin/*. Two invariants, both silent if broken:
 *
 *  1. Every write sends `Content-Type: application/json`, body or not —
 *     `withAdminWrite` rejects anything else, and that pairing is the CSRF
 *     defence.
 *  2. The `error` code from a failed response is what the thrown error
 *     carries, so a toast can show it.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export type Query = Record<
  string,
  string | number | boolean | null | undefined
>;

/** A same-origin URL, with empty params dropped so a cleared filter leaves no `?q=` behind. */
export function apiUrl(path: string, query?: Query): string {
  if (!path.startsWith('/')) {
    // These requests carry the session cookie and must never leave the origin.
    throw new Error(`api path must be same-origin and absolute, got: ${path}`);
  }
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: init?.signal,
  });

  if (res.status === 401 && path.startsWith('/api/admin/')) {
    // The session ended mid-visit: back to the sign-in page, which comes
    // back here after Google.
    window.location.assign(
      `${adminPath('/login')}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
    throw new ApiClientError('unauthorized', 401);
  }
  if (!res.ok) {
    let message = `request_failed_${res.status}`;
    let issues: unknown;
    try {
      const parsed = (await res.json()) as { error?: string; issues?: unknown };
      if (parsed.error) message = parsed.error;
      issues = parsed.issues;
    } catch {
      // Not JSON: keep the status-based code.
    }
    throw new ApiClientError(message, res.status, issues);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  put: <T>(path: string, body?: unknown) =>
    request<T>('PUT', apiUrl(path), body ?? {}),
  get: <T>(path: string, query?: Query, init?: { signal?: AbortSignal }) =>
    request<T>('GET', apiUrl(path, query), undefined, init),
  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', apiUrl(path), body ?? {}),
  post: <T>(path: string, body?: unknown) =>
    request<T>('POST', apiUrl(path), body ?? {}),
  del: <T>(path: string, body?: unknown) =>
    request<T>('DELETE', apiUrl(path), body ?? {}),
};
