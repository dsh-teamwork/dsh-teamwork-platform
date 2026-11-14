/**
 * One way every console write behaves: disable while it runs, toast the
 * outcome (CLAUDE.md asks every mutation to report itself), word a failure
 * from its error code, and read the page's data again with what changed.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { ApiError } from '@/lib/api';

/** A failure in the reader's language: the server's code where `teamErrors` words it, else a generic one. */
export function useTeamError() {
  const te = useTranslations('teamErrors');
  return (error: unknown) => {
    const code = error instanceof ApiError ? error.code : 'internal_error';
    return te.has(code) ? te(code) : te('internal_error');
  };
}

export function useMutation(reload: () => Promise<unknown>) {
  const word = useTeamError();
  const [pending, setPending] = useState(false);

  /** Resolves true once `action` succeeded, false once it failed and the failure was shown; a dialog uses it to stay on its step. */
  async function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    setPending(true);
    try {
      await action();
      if (success) toast.success(success);
      await reload();
      return true;
    } catch (error) {
      toast.error(word(error));
      return false;
    } finally {
      setPending(false);
    }
  }

  return { pending, run };
}
