import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';

import { Analytics } from '@/components/analytics';
import { ThemeProvider } from '@/components/theme-provider';
import { siteOrigin } from '@/lib/site';

import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  return {
    metadataBase: new URL(siteOrigin()),
    title: { default: 'DSH Teamwork', template: '%s · DSH Teamwork' },
    description: t('tagline'),
    // No title or description here: Next fills both from the page rendering.
    openGraph: { type: 'website', siteName: 'DSH Teamwork' },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <NextIntlClientProvider>
            {children}
            <Toaster richColors />
            <Analytics />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
