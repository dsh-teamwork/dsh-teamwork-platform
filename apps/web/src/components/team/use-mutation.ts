'use client';

/**
 * One way every console write behaves: disable while it runs, toast the
 * outcome (CLAUDE.md asks every mutation to report itself), word a failure
 * from its error code, and re-render the server page with what changed.
 */

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { ApiCallError } from '@/lib/api-client';

export function useMutation() {
  const router = useRouter();
  const te = useTranslations('teamErrors');
  const [pending, startTransition] = useTransition();

  /** Resolves true once `action` succeeded, false once it failed and the failure was shown; a dialog uses it to stay on its step. */
  function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        try {
          await action();
          if (success) toast.success(success);
          router.refresh();
          resolve(true);
        } catch (error) {
          const code = error instanceof ApiCallError ? error.code : 'internal_error';
          toast.error(te.has(code) ? te(code) : te('internal_error'));
          resolve(false);
        }
      });
    });
  }

  return { pending, run };
}
