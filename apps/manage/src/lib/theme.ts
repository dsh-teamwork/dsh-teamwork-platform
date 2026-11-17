/**
 * Light or dark, kept in this browser. A person who has not chosen gets their
 * system's setting and keeps following it until they choose; the member
 * console (apps/console/src/lib/theme.ts) keeps the same key, so one choice
 * holds on every page of the site. `.dark` on <html> swaps the whole scale
 * (globals.css). Set before the first render, from main.tsx: the console's
 * Content Security Policy refuses an inline script in the page.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'theme';
const listeners = new Set<() => void>();
const media = matchMedia('(prefers-color-scheme: dark)');

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage refused: fall back to the system's.
  }
  return media.matches ? 'dark' : 'light';
}

function notify() {
  for (const listener of listeners) listener();
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', read() === 'dark');
}

media.addEventListener('change', () => {
  applyTheme();
  notify();
});

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  applyTheme();
  notify();
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, read);
}
