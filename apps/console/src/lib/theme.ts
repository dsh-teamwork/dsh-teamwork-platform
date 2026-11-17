/**
 * Light or dark. A person who has not chosen gets their system's setting, and
 * keeps following it until they choose; a choice is kept in this browser under
 * the key the instance console (apps/manage/src/lib/theme.ts) uses, so it holds
 * on every page of the site. `.dark` on <html> swaps the whole scale
 * (globals.css). It imports no React, so the public pages' script can use it.
 * The first paint is set before any of this loads, by `THEME_SCRIPT` in the
 * public pages and the same lines in index.html.
 */

export type Theme = 'light' | 'dark';

const KEY = 'theme';
const listeners = new Set<() => void>();
const system = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** The theme in force: the person's choice, else the system's. */
export function readTheme(): Theme {
  return saved() ?? system();
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', readTheme() === 'dark');
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

export const otherTheme = (theme: Theme): Theme => (theme === 'dark' ? 'light' : 'dark');

/** Follows the system while the person has not chosen. Call once per page. */
export function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme();
    for (const listener of listeners) listener();
  });
}

/** Tells `listener` when the theme in force changes; returns how to stop. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same rule, before the first paint, as an inline script for a prerendered page. */
export const THEME_SCRIPT =
  "(function(){var t=null;try{t=localStorage.getItem('theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t==='dark')document.documentElement.classList.add('dark')})()";
