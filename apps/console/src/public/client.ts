/**
 * The one script the prerendered public pages load (src/public/render.tsx):
 * browser analytics, and the home page's language picker, which writes the
 * choice (the `locale` cookie, and the profile when signed in) and reloads, so
 * the server picks the page in that language.
 */

import { startAnalytics } from '@/lib/analytics';

void startAnalytics();

const picker = document.querySelector<HTMLSelectElement>('select[data-locale-picker]');
picker?.addEventListener('change', async () => {
  picker.disabled = true;
  try {
    const res = await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: picker.value }),
    });
    if (res.ok) {
      location.reload();
      return;
    }
  } catch {
    // Offline: handled below, as a refusal is.
  }
  // The page stays in its language, so the picker goes back to saying so.
  picker.value = Array.from(picker.options).find((o) => o.defaultSelected)?.value ?? picker.value;
  picker.disabled = false;
});
