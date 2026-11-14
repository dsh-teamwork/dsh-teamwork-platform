/**
 * The interface languages, shared by the console and the mobile app so both
 * offer the same list and resolve a browser's or a device's tag to the same
 * one. The Go server applies the same rule to the pages it serves
 * (server/internal/web/locale.go).
 *
 * The locale is never in the URL. Signed in, it is `User.locale`; signed out,
 * a cookie on web and a stored preference on mobile; with nothing chosen, the
 * browser's or the device's, through `matchLocale`.
 */

export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Each language's name for itself. A picker that names languages in a language
 * the reader cannot read is useless, so these are endonyms on purpose (and the
 * one file `pnpm lint:lang` exempts for it).
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The best supported locale for a list of BCP 47 tags in preference order
 * (`Accept-Language`, `navigator.languages`, expo-localization), or the
 * default. An exact match wins; otherwise the language subtag decides, so
 * `zh`, `zh-Hans` and `zh-SG` all read Simplified Chinese.
 */
export function matchLocale(tags: readonly string[] | string | null | undefined): Locale {
  const list = typeof tags === 'string' ? parseAcceptLanguage(tags) : (tags ?? []);
  for (const tag of list) {
    const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split('-')[0]?.toLowerCase();
    if (language === 'zh') {
      // Traditional-script tags are not Simplified Chinese; fall through to
      // the next preference rather than guess.
      if (/-(hant|tw|hk|mo)\b/i.test(tag)) continue;
      return 'zh-CN';
    }
    const byLanguage = LOCALES.find((l) => l.split('-')[0] === language);
    if (byLanguage) return byLanguage;
  }
  return DEFAULT_LOCALE;
}

/** `Accept-Language` in preference order, `q=0` entries dropped. */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag?.trim() ?? '', q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}
