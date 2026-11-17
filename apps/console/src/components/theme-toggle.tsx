import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';

import { nextTheme, readTheme, setTheme, subscribeTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * One icon button: it shows the theme in force and steps light → dark →
 * system. The public pages draw the same button without React
 * (src/public/controls.tsx).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common.theme');
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const Icon = ICONS[theme];
  const label = t('label', { current: t(theme), next: t(nextTheme(theme)) });
  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme(theme))}
      aria-label={label}
      title={label}
      className={cn('grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
