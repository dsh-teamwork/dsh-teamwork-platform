/**
 * Light, dark or the system's, kept in this browser. `.dark` on <html> swaps
 * the whole scale (globals.css). Set before the first render, from main.tsx:
 * the console's Content Security Policy refuses an inline script in the page.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'theme';
const listeners = new Set<() => void>();
const media = matchMedia('(prefers-color-scheme: dark)');

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme() {
  const theme = read();
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && media.matches),
  );
}

media.addEventListener('change', applyTheme);

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, read);
}
