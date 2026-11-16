import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

export type ParamPatch = Record<string, string | number | null | undefined>;

export interface SetOpts {
  /**
   * "push" (default) adds a history entry so Back steps through the change.
   * Use "replace" for debounced text input, so Back does not walk the user
   * back one keystroke at a time.
   */
  mode?: 'push' | 'replace';
  /**
   * By default any change that is not itself a `page` change resets pagination
   * — landing on page 7 of a freshly narrowed result set is never what the
   * operator wanted. Pass false to opt out.
   */
  resetPage?: boolean;
}

function applyPatch(
  current: URLSearchParams,
  patch: ParamPatch,
  resetPage: boolean,
): URLSearchParams {
  const sp = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') sp.delete(key);
    else sp.set(key, String(value));
  }
  if (resetPage) sp.delete('page');
  return sp;
}

/**
 * URL-backed filter state for the admin pages.
 *
 * Filters and pagination live in the query string so a narrowed view is
 * shareable and one page can deep-link into another with the filter already
 * applied.
 *
 * Writes go through the router, so the page re-renders with the new query.
 */
export function useQueryParams<
  T extends Record<string, string | undefined> = Record<
    string,
    string | undefined
  >,
>() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const serialized = searchParams.toString();

  const params = useMemo(
    () => Object.fromEntries(new URLSearchParams(serialized).entries()) as T,
    [serialized],
  );

  const buildHref = useCallback(
    (patch: ParamPatch, resetPage?: boolean) => {
      const shouldReset = resetPage ?? !('page' in patch);
      const qs = applyPatch(
        new URLSearchParams(serialized),
        patch,
        shouldReset,
      ).toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [serialized, pathname],
  );

  const set = useCallback(
    (patch: ParamPatch, opts?: SetOpts) => {
      const url = buildHref(patch, opts?.resetPage);
      navigate(url, { replace: (opts?.mode ?? 'push') === 'replace' });
    },
    [buildHref, navigate],
  );

  /** For <Link>/<a>: the href a patch would produce. */
  const href = useCallback(
    (patch: ParamPatch) => buildHref(patch),
    [buildHref],
  );

  return { params, set, href };
}
