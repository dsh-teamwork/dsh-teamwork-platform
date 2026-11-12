import type { MetadataRoute } from 'next';

import { hasLegalPages, LEGAL_PATHS } from '@/lib/legal';
import { siteOrigin } from '@/lib/site';

/**
 * The pages worth indexing: the home page, and the legal pages where this
 * deployment publishes them. Signed-in and sign-in screens are left out on purpose.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const paths = ['/', ...(hasLegalPages() ? Object.values(LEGAL_PATHS) : [])];
  return paths.map((path) => ({ url: `${origin}${path === '/' ? '' : path}` }));
}
