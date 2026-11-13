'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type { ReturnTo } from '@dsh-teamwork/shared/server/nextauth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authorizePlugin } from '@/lib/auth/actions';

/** `returnTo`: the requester's own address, which receives the code as `?code=` instead of the person copying it. */
export function PluginAuthorize({ challenge, returnTo }: { challenge: string; returnTo?: ReturnTo }) {
  const t = useTranslations('plugin');
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (code && returnTo) {
    // Shown while the app opens, and kept as the way back if it does not.
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{t(returnTo.to === 'dsh' ? 'returningDsh' : 'returning')}</p>
        <Input readOnly value={returnTo.to === 'dsh' ? `/teamwork authorize ${code}` : code} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
        <p className="text-xs text-muted-foreground">{t('expiry')}</p>
      </div>
    );
  }
  if (code) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{t('copy')}</p>
        <Input readOnly value={`/teamwork authorize ${code}`} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
        <p className="text-xs text-muted-foreground">{t('expiry')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {failed && <p className="text-sm text-destructive">{t('failed')}</p>}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const minted = await authorizePlugin(challenge);
            if (!minted) return setFailed(true);
            setCode(minted);
            if (returnTo) {
              const back = new URL(returnTo.url);
              back.searchParams.set('code', minted);
              window.location.href = back.toString();
            }
          })
        }
      >
        {t('confirm')}
      </Button>
    </div>
  );
}
