import { Check, Languages } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
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

/**
 * The language in a page's header, as the public home's header draws it
 * (src/public/controls.tsx, `placement="header"`): a quiet button with the
 * languages icon and the current name, opening a menu downwards.
 */
export function HeaderLocaleMenu() {
  const t = useTranslations('common');
  const locale = useLocale();
  const { pending, choose } = useChooseLocale();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={pending}
        aria-label={t('language')}
        title={t('language')}
        className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      >
        <Languages className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t(`localeNames.${locale}`)}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-40 rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
          <DropdownMenu.RadioGroup value={locale} onValueChange={(next) => next !== locale && void choose(next)}>
            {LOCALES.map((l) => (
              <DropdownMenu.RadioItem key={l} value={l} className="relative flex items-center rounded-md py-1.5 pr-8 pl-2.5 text-sm outline-none data-[highlighted]:bg-accent">
                {t(`localeNames.${l}`)}
                <DropdownMenu.ItemIndicator className="absolute right-2">
                  <Check className="size-4" aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
