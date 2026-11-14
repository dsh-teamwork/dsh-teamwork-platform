import { useState } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

import { useTeamError } from '@/components/team/use-mutation';
import { api } from '@/lib/api';
import { LOCALES } from '@/lib/locale';

/** Writes the choice to the `locale` cookie and the profile, then loads the page again in it. */
export function LocalePicker() {
  const t = useTranslations('common');
  const word = useTeamError();
  const locale = useLocale();
  const [pending, setPending] = useState(false);

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {t('language')}
      <select
        className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
        value={locale}
        disabled={pending}
        onChange={async (event) => {
          setPending(true);
          try {
            await api('locale', { body: { locale: event.target.value } });
            window.location.reload();
          } catch (error) {
            toast.error(word(error));
            setPending(false);
          }
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`localeNames.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
