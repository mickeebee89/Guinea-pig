import type { MetadataRoute } from 'next'
import { IS_LIVE, SITE_URL, TREATMENTS } from '@/lib/site'

export const revalidate = 3600

/**
 * No `lastModified` anywhere. providers has no created_at or updated_at
 * column (verified against the live schema), so the only honest timestamp
 * available would be "now" on every entry — which teaches Google to ignore the
 * field entirely. Omitting it is better than faking it.
 *
 * City pages are deliberately absent: they are built but held back until there
 * is inventory on them, because 48 near-empty templated pages on a new domain
 * is the doorway pattern that earns a site-wide penalty.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Preview deployments emit nothing at all, so a stray robots.txt edit can
  // never accidentally expose an unfinished site to a crawler.
  if (!IS_LIVE) return []

  return [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/for-stylists`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/for-models`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.7 },
    ...TREATMENTS.map((t) => ({
      url: `${SITE_URL}/${t.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/community`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/delete-account`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
