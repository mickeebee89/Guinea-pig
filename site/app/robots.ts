import type { MetadataRoute } from 'next'
import { IS_LIVE, SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  // Until PUBLIC_SITE_MODE=live, nothing is indexable. Seeded demo stylists are
  // still in the database (launch blocker #75) and must never reach the index.
  if (!IS_LIVE) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
