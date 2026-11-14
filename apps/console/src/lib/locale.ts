/**
 * The viewer's language. The languages and the rule that picks one are
 * `@dsh-teamwork/shared`'s, which the mobile app reads too. The locale is
 * never in the URL: a chosen one is the profile's or the `locale` cookie,
 * otherwise the browser's.
 */
import { LOCALES, type Locale, matchLocale } from '@dsh-teamwork/shared';

export { LOCALES, type Locale };

/**
 * What the server resolved (the profile's, then the cookie, then the
 * browser's) and wrote on the root element, else, in development, the cookie
 * and the browser's languages.
 */
export function currentLocale(): Locale {
  const resolved = document.documentElement.dataset.locale;
  if (resolved && (LOCALES as readonly string[]).includes(resolved)) return resolved as Locale;
  const chosen = /(?:^|;\s*)locale=([^;]+)/.exec(document.cookie)?.[1];
  return matchLocale([...(chosen ? [decodeURIComponent(chosen)] : []), ...navigator.languages]);
}
