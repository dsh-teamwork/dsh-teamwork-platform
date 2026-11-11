/**
 * The browser's side of the web API: a JSON call that answers the parsed body
 * or throws `ApiCallError` carrying the server's `{ error }` code, which a
 * component words through `teamErrors.*` rather than showing as is.
 */

import { ApiErrorSchema } from '@dsh-teamwork/shared';

export class ApiCallError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ApiCallError';
  }
}

export async function callApi<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiCallError(ApiErrorSchema.safeParse(json).data?.error ?? 'internal_error');
  return json as T;
}
