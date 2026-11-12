'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authorizePlugin } from '@/lib/auth/actions';

export function PluginAuthorize({ challenge }: { challenge: string }) {
  const t = useTranslations('plugin');
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

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
            if (minted) setCode(minted);
            else setFailed(true);
          })
        }
      >
        {t('confirm')}
      </Button>
    </div>
  );
}
