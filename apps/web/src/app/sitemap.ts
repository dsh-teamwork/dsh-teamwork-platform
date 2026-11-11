import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/site';

/** The pages worth indexing. Signed-in and sign-in screens are left out on purpose. */
export const SITEMAP_PATHS = ['/'];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return SITEMAP_PATHS.map((path) => ({ url: `${origin}${path === '/' ? '' : path}` }));
}
