import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/site';
import { aiTrainingRule } from '@/lib/ai-crawlers';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/account', '/auth/', '/teams', '/plugin'] },
      aiTrainingRule(),
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
