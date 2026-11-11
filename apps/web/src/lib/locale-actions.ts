'use server';

import { isLocale } from '@dsh-teamwork/shared';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { currentUser } from '@/lib/auth';
import { LOCALE_COOKIE } from '@/lib/locale';
import { prisma } from '@/lib/prisma';

/**
 * The language picker's one action. The cookie is written for everybody, so a
 * choice made while signed out survives signing in; a signed-in choice also
 * goes on the profile, so it follows the account to another browser.
 */
export async function chooseLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const user = await currentUser();
  if (user) await prisma.user.update({ where: { id: user.id }, data: { locale } });
  revalidatePath('/', 'layout');
}
