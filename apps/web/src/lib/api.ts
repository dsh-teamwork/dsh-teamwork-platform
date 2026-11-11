/**
 * The one shape a route answers a failure in: `{ error, issues? }`, where
 * `error` is a stable code a client branches on (`ApiErrorSchema` and
 * `TEAM_ERRORS` in `@dsh-teamwork/shared`), never a sentence it would have to parse.
 */

import type { ApiError } from '@dsh-teamwork/shared';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { UnauthorizedError } from '@/lib/auth';
import { TeamError } from '@/lib/team';

export function apiError(status: number, error: string, extra?: Omit<ApiError, 'error'>) {
  return NextResponse.json<ApiError>({ error, ...extra }, { status });
}

/** The largest body a JSON route reads unless it names its own limit. */
const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * The request body as JSON, or `null` when it is not JSON at all. A malformed
 * body is the caller's mistake: `null` fails the route's schema and becomes a
 * 400 through `handleRouteError`, where `request.json()` would throw a
 * SyntaxError and surface as a 500. A body over `maxBytes` is a 413, counted
 * as it streams so a chunked upload cannot get round a missing Content-Length.
 * A provider's `Response` is read the same way, under its own limit.
 */
export async function readJson(request: Request | Response, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new TeamError(413, 'payload_too_large');
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new TeamError(413, 'payload_too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Map what a handler threw to a response. Anything unexpected is logged and is a 500. */
export function handleRouteError(error: unknown, route: string) {
  if (error instanceof UnauthorizedError) return apiError(401, 'unauthorized');
  if (error instanceof TeamError) return apiError(error.status, error.code);
  if (error instanceof ZodError) {
    return apiError(400, 'invalid_request', {
      issues: error.issues.map((issue) => ({
        path: issue.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: issue.message,
      })),
    });
  }
  console.error(`[${route}]`, error);
  return apiError(500, 'internal_error');
}
