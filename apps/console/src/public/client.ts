/**
 * The one script the prerendered public pages load (src/public/render.tsx):
 * browser analytics, and the controls src/public/controls.tsx draws: the
 * language menu, the theme button, and the copy buttons.
 */

import { startAnalytics } from '@/lib/analytics';
import { nextTheme, readTheme, setTheme, watchSystemTheme } from '@/lib/theme';

void startAnalytics();

watchSystemTheme();

// The language menu (src/public/controls.tsx): writes the choice (the `locale`
// cookie, and the profile when signed in) and reloads, so the server picks the
// page in that language. A refusal leaves the page as it is.
for (const item of document.querySelectorAll<HTMLButtonElement>('button[data-locale]')) {
  item.addEventListener('click', async () => {
    if (item.getAttribute('aria-checked') === 'true') {
      item.closest('details')?.removeAttribute('open');
      return;
    }
    item.disabled = true;
    try {
      const res = await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: item.dataset.locale }),
      });
      if (res.ok) {
        location.reload();
        return;
      }
    } catch {
      // Offline: handled below, as a refusal is.
    }
    item.disabled = false;
  });
}

// The theme button steps light → dark → system; the icon follows `data-theme-choice`.
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-theme-toggle]')) {
  button.addEventListener('click', () => setTheme(nextTheme(readTheme())));
}

// An open menu (<details data-menu>) closes on a click outside it, or on Escape.
document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]')) {
    if (!menu.contains(event.target as Node)) menu.open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]')) menu.open = false;
});

// The home page's copy buttons: the command beside each stays selectable when the clipboard is refused.
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? '');
      button.textContent = '✓';
      setTimeout(() => (button.textContent = label), 1500);
    } catch {
      const code = button.previousElementSibling;
      if (code) window.getSelection()?.selectAllChildren(code);
    }
  });
}
