/**
 * Light, dark or the system's, kept in this browser under the same key the
 * instance console (apps/manage/src/lib/theme.ts) uses, so one choice holds on
 * every page of the site. `.dark` on <html> swaps the whole scale
 * (globals.css), and `data-theme-choice` says which of the three is chosen.
 * It imports no React, so the public pages' script can use it. The first
 * paint is set before any of this loads, by `THEME_SCRIPT` in the
 * public pages and the same lines in index.html.
 */
export type Theme = 'light' | 'dark' | 'system';

/** Light, dark, then the system's, then light again: the order the toggle steps through. */
export const THEMES: Theme[] = ['light', 'dark', 'system'];

const KEY = 'theme';
const listeners = new Set<() => void>();

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme() {
  const theme = readTheme();
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
  root.dataset.themeChoice = theme;
}

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

export const nextTheme = (theme: Theme) => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

/** Follows the system while "system" is chosen. Call once per page. */
export function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

/** Tells `listener` when the choice changes; returns how to stop. */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same choice, before the first paint, as an inline script for a prerendered page. */
export const THEME_SCRIPT =
  "(function(){var t='system';try{var s=localStorage.getItem('theme');if(s==='light'||s==='dark')t=s}catch(e){}var r=document.documentElement;r.dataset.themeChoice=t;if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))r.classList.add('dark')})()";
