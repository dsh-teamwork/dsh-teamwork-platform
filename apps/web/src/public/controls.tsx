/**
 * The public pages' two controls, drawn to look like the console's own
 * (components/theme-toggle.tsx, components/ui/select.tsx) but without React in
 * the browser: the markup is prerendered and src/public/client.ts wires it.
 * The theme button shows the theme in force through `.dark` on <html>, which
 * the first-paint script sets; the language menu is a <details> whose items post the choice and reload.
 */

import { Check, ChevronDown, Languages, Moon, Sun } from 'lucide-react';

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

/**
 * The language. In a footer it is a bordered select opening upwards; in a
 * header it sits beside the theme button, drawn like it, and opens downwards.
 */
export function LocaleMenu({
  locale,
  label,
  names,
  placement = 'footer',
}: {
  locale: Locale;
  label: string;
  names: (l: Locale) => string;
  placement?: 'header' | 'footer';
}) {
  const header = placement === 'header';
  return (
    <details data-menu="" className="relative">
      <summary
        aria-label={label}
        title={header ? label : undefined}
        className={cn(
          'flex h-9 cursor-pointer list-none items-center rounded-md text-sm hover:bg-accent [&::-webkit-details-marker]:hidden',
          header
            ? 'gap-1.5 px-2.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
            : 'gap-2 border border-input bg-background px-3 text-foreground',
        )}
      >
        {header ? (
          <>
            <Languages className="size-4" aria-hidden />
            <span className="hidden sm:inline">{names(locale)}</span>
          </>
        ) : (
          <>
            {names(locale)}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </>
        )}
      </summary>
      <div
        role="menu"
        className={cn(
          'absolute right-0 z-20 min-w-40 rounded-lg border bg-card p-1 text-card-foreground shadow-lg',
          header ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
        )}
      >
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
