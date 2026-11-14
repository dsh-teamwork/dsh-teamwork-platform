/**
 * The interface languages and how a browser's preference resolves to one,
 * as packages/shared/src/locales.ts does for the Node server. The locale is
 * never in the URL: a chosen one is the `locale` cookie, otherwise the
 * browser's.
 */

export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The best supported locale for tags in preference order. An exact match
 * wins; otherwise the language decides, so `zh`, `zh-Hans` and `zh-SG` read
 * Simplified Chinese, and a Traditional-script tag falls through.
 */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split('-')[0]?.toLowerCase();
    if (language === 'zh') {
      if (/-(hant|tw|hk|mo)\b/i.test(tag)) continue;
      return 'zh-CN';
    }
    const byLanguage = LOCALES.find((l) => l.split('-')[0] === language);
    if (byLanguage) return byLanguage;
  }
  return DEFAULT_LOCALE;
}

/** The cookie's choice, else the browser's languages. */
export function currentLocale(): Locale {
  const chosen = /(?:^|;\s*)locale=([^;]+)/.exec(document.cookie)?.[1];
  return matchLocale([...(chosen ? [decodeURIComponent(chosen)] : []), ...navigator.languages]);
}
