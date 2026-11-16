import { t } from '../lib/copy';
import { Monitor, Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '../lib/theme';
import { cn } from '../lib/utils';

const OPTIONS = [
  { value: 'light', label: t('light'), icon: Sun },
  { value: 'dark', label: t('dark'), icon: Moon },
  { value: 'system', label: t('system'), icon: Monitor },
] as const;

/** Light / dark / system. */
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme')}
      className="flex gap-1 rounded-md border border-border p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            'flex flex-1 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground',
            theme === value && 'bg-secondary text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
