import { supabase, type PublicStylist } from './supabase-public'

const CARD_COLUMNS =
  'id, slug, name, location, categories, rating, review_count, is_verified, profile_pic_url'

/**
 * Every stylist read on the public site goes through here, so that a missing
 * view, an RLS refusal or a network blip all degrade the same way: an empty
 * list and a warning in the server log, never a thrown error that takes a page
 * down. Pre-launch the empty list is the normal answer, not a failure.
 *
 * The warning matters — this codebase has been bitten before by the `if (data)`
 * pattern turning a column typo into a silent "nothing here" (see
 * scripts/check-queries.mjs). A broken query should be visible in the log.
 */
async function safeList(
  label: string,
  build: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<PublicStylist[]> {
  try {
    const { data, error } = await build()
    if (error) {
      // ⚠️ THIS MAKES EVERY FAILURE LOOK LIKE EMPTINESS. Audit item 18.
      //
      // A missing view, an RLS refusal, a REVOKED GRANT and a genuinely empty
      // table all end here and all produce the same thing: an empty array, a
      // 200, and the page's empty state.
      //
      // Degrading rather than throwing is right and stays. The problem is that
      // nothing downstream can tell the causes apart, and the six treatment
      // pages are ALREADY empty for an unrelated reason (the 40-char bio bar,
      // item 11) — so a broken public site and a correct one are byte-for-byte
      // identical, and this warn in a Vercel function log is the only signal.
      //
      // If you are adding a signal, add it here rather than at the call sites:
      // this is the one place that knows the difference.
      console.warn(`[${label}] query failed, returning none:`, error.message)
      return []
    }
    return (data ?? []) as PublicStylist[]
  } catch (err) {
    console.warn(`[${label}] unreachable, returning none:`, err)
    return []
  }
}

/** Stylists offering a given treatment, nationally. `dbSlug` must match treatment_categories.slug. */
export function stylistsByCategory(dbSlug: string, limit = 12) {
  return safeList(`stylistsByCategory:${dbSlug}`, () =>
    supabase
      .from('public_stylists')
      .select(CARD_COLUMNS)
      .contains('category_slugs', [dbSlug])
      .order('review_count', { ascending: false })
      .limit(limit),
  )
}

/**
 * How many stylists offer a treatment. Uses a head request with an exact count
 * so the number is real rather than the length of a truncated page.
 */
export async function countByCategory(dbSlug: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('public_stylists')
      .select('id', { count: 'exact', head: true })
      .contains('category_slugs', [dbSlug])
    if (error) {
      console.warn(`[countByCategory:${dbSlug}] failed:`, error.message)
      return 0
    }
    return count ?? 0
  } catch (err) {
    console.warn(`[countByCategory:${dbSlug}] unreachable:`, err)
    return 0
  }
}
