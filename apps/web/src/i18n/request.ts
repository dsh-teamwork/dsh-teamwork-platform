import { getRequestConfig } from 'next-intl/server';

import { viewerLocale } from '@/lib/locale';

// The locale is not a URL segment, so there is no `requestLocale` to read; it
// comes from `viewerLocale`, which only ever returns a supported one — so the
// import below can never be handed a catalog that is not on disk.
export default getRequestConfig(async () => {
  const locale = await viewerLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
