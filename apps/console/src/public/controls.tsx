/**
 * The public pages' two controls, drawn to look like the console's own
 * (components/theme-toggle.tsx, components/ui/select.tsx) but without React in
 * the browser: the markup is prerendered and src/public/client.ts wires it.
 * The theme button shows the theme in force through `.dark` on <html>, which
 * the first-paint script sets; the language menu is a <details> whose items post the choice and reload.
 */

import { Check, ChevronDown, Moon, Sun } from 'lucide-react';

import { LOCALES, type Locale } from '@/lib/locale';
import { cn } from '@/lib/utils';

export function ThemeButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      data-theme-toggle=""
      aria-label={label}
      title={label}
      className={cn('grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}
    >
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}

/** The language, opening upwards: it lives in a footer. */
export function LocaleMenu({ locale, label, names }: { locale: Locale; label: string; names: (l: Locale) => string }) {
  return (
    <details data-menu="" className="relative">
      <summary
        aria-label={label}
        className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground hover:bg-accent [&::-webkit-details-marker]:hidden"
      >
        {names(locale)}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </summary>
      <div role="menu" className="absolute right-0 bottom-full z-20 mb-1.5 min-w-40 rounded-lg border bg-card p-1 text-card-foreground shadow-lg">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            role="menuitemradio"
            aria-checked={l === locale}
            data-locale={l}
            className="relative flex w-full items-center rounded-md py-1.5 pr-8 pl-2.5 text-left text-sm hover:bg-accent"
          >
            {names(l)}
            {l === locale && <Check className="absolute right-2 size-4" aria-hidden />}
          </button>
        ))}
      </div>
    </details>
  );
}
