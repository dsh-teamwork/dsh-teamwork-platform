'use client';

import { LOCALE_NAMES, LOCALES, type Locale } from '@dsh-teamwork/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { chooseLocale } from '@/lib/locale-actions';

export function LocalePicker() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {t('language')}
      <select
        className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
        value={locale}
        disabled={pending}
        onChange={(event) => startTransition(() => chooseLocale(event.target.value))}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
