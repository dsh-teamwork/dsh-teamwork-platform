/**
 * Which language a page renders in. Never the URL: the signed-in profile's
 * choice, then the `locale` cookie a signed-out visitor's picker writes, then
 * the browser's `Accept-Language`.
 */

import 'server-only';

import { isLocale, matchLocale, type Locale } from '@dsh-teamwork/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { currentUser } from '@/lib/auth';

export const LOCALE_COOKIE = 'locale';

export const viewerLocale = cache(async (): Promise<Locale> => {
  const user = await currentUser();
  if (isLocale(user?.locale)) return user.locale;
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return matchLocale((await headers()).get('accept-language'));
});
