'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl, type Query } from './api-client';

export interface UseApiResult<T> {
  data: T | undefined;
  error: Error | undefined;
  /** No data yet — render a skeleton. */
  loading: boolean;
  /** Background refetch with data still on screen — render a subtle indicator. */
  refreshing: boolean;
  refetch: () => void;
}

interface State<T> {
  /** The request key whose result `data`/`error` describe. */
  key: string | null;
  data?: T;
  error?: Error;
}

/**
 * Fetch JSON from the admin API, tracking loading/error state.
 *
 * Deliberately not SWR: there is no cross-component cache to invalidate here,
 * and every page owns exactly one query. Three details do the real work:
 *
 *  - The effect depends on the *serialized URL*, not the query object. Callers
 *    can pass a fresh object literal every render without useMemo and without
 *    an infinite loop — the usual failure mode of a hand-rolled fetch hook.
 *  - "Pending" is derived by comparing the settled key against the current one,
 *    never assigned inside the effect. Setting it synchronously there would
 *    cascade an extra render on every query change (and React's lint rule
 *    rejects it).
 *  - The `cancelled` flag, closed over per effect run, is what actually stops a
 *    stale response from landing. Aborting alone does not: a slow request that
 *    already resolved will still run its `.then` after a newer one, which is how
 *    fast typing in a filter box leaves a table showing superseded results.
 *
 * Previous data is kept while refreshing, so changing a filter does not flash
 * an empty table. A failed refresh likewise keeps the rows on screen and
 * surfaces `error` alongside them.
 */
export function useApi<T>(
  path: string | null,
  query?: Query,
  opts?: { skip?: boolean },
): UseApiResult<T> {
  const skip = opts?.skip === true || path === null;
  const url = path === null ? null : apiUrl(path, query);

  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null });

  // The nonce is part of the key so an explicit refetch() re-enters the
  // pending state instead of looking instantly settled.
  const key = skip || url === null ? null : `${nonce}\u0000${url}`;

  useEffect(() => {
    if (key === null || url === null) return;

    let cancelled = false;
    const controller = new AbortController();

    api
      .get<T>(url, undefined, { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        setState({ key, data: result, error: undefined });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          key,
          data: prev.data,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, url]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const pending = key !== null && state.key !== key;

  return {
    data: state.data,
    error: state.error,
    loading: pending && state.data === undefined,
    refreshing: pending && state.data !== undefined,
    refetch,
  };
}
