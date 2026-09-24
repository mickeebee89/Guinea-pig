import type { MetadataRoute } from 'next'
import { IS_LIVE, SITE_URL, TREATMENTS, MIN_STYLISTS_TO_INDEX } from '@/lib/site'
import { countByCategory } from '@/lib/stylists'

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
 *
 * ⚠️ TREATMENT PAGES ARE NOW FILTERED BY THE SAME RULE THEY APPLY TO
 * THEMSELVES (item 114). A page below MIN_STYLISTS_TO_INDEX emits
 * `robots: noindex`, and listing it here anyway would be the site telling a
 * crawler two different things about the same URL. The shared constant and the
 * shared count are what stop those drifting — they were one judgement made in
 * one place, and that is the only reason they agree.
 *
 * Async now, because it asks the database. Six head-counts an hour.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Preview deployments emit nothing at all, so a stray robots.txt edit can
  // never accidentally expose an unfinished site to a crawler.
  if (!IS_LIVE) return []

  // countByCategory degrades to 0 on any failure, so a database wobble hides
  // the treatment pages from the sitemap for an hour rather than listing pages
  // that will answer noindex. Quiet is the safe direction here.
  const counts = await Promise.all(TREATMENTS.map((t) => countByCategory(t.dbSlug)))
  const indexableTreatments = TREATMENTS.filter(
    (_t, i) => counts[i] >= MIN_STYLISTS_TO_INDEX,
  )

  return [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/for-stylists`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/for-models`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.7 },
    ...indexableTreatments.map((t) => ({
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
