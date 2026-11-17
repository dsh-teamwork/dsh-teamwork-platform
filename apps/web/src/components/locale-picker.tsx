import { useState } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

import { useTeamError } from '@/components/team/use-mutation';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { LOCALES } from '@/lib/locale';

/** Writes the choice to the `locale` cookie and the profile, then loads the page again in it. */
export function useChooseLocale() {
  const word = useTeamError();
  const [pending, setPending] = useState(false);
  async function choose(next: string) {
    setPending(true);
    try {
      await api('locale', { body: { locale: next } });
      window.location.reload();
    } catch (error) {
      toast.error(word(error));
      setPending(false);
    }
  }
  return { pending, choose };
}

/** The language, in the console's one select (components/ui/select.tsx); each language named in itself. */
export function LocalePicker({ className }: { className?: string }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const { pending, choose } = useChooseLocale();
  return (
    <Select
      label={t('language')}
      value={locale}
      disabled={pending}
      options={LOCALES.map((l) => ({ value: l, label: t(`localeNames.${l}`) }))}
      change={(next) => next !== locale && void choose(next)}
      className={className}
    />
  );
}
