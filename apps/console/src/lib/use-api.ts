import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';

/**
 * What a page reads from the API, and `reload` to read it again after a
 * write. A null `path` reads nothing (a member asking for what only an admin
 * sees). While a reload runs the last answer stays on screen; an answer for a
 * path the page has since left, or older than another read, is dropped.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: unknown }>({ path: null });
  // Each read is numbered; only the newest one's answer is kept, so an older
  // read for the same path that answers late cannot undo a newer one.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const read = ++latest.current;
    if (path === null) return;
    try {
      const data = await api<T>(path);
      if (latest.current === read) setState({ path, data });
    } catch (error) {
      if (latest.current === read) setState((s) => ({ path, data: s.path === path ? s.data : undefined, error }));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const current = state.path === path ? state : { path, data: undefined, error: undefined };
  return { data: current.data, error: current.error, reload };
}
