import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The stylist's own shop: what it says, what it offers, and how far through
 * setup they are.
 *
 * ── WHY SETUP IS A QUERY AND NOT A FLAG ───────────────────────────────────
 * There is no `setup_complete` column and there should not be one. Every step
 * here is derived from the thing it is actually about — a name on the row, a
 * treatment row existing, a verification request's status. A flag would be a
 * second source of truth that drifts the first time someone clears their bio,
 * and "the app says I'm set up but my profile is empty" is unanswerable.
 *
 * ── PUBLISHING IS NOT A STEP THE STYLIST TAKES ────────────────────────────
 * A person approves the ID check, and that approval sets both `is_verified`
 * and `providers.is_published` (admin/app/verification/page.tsx). The database
 * enforces the same order — `enforce_publish_requires_verified` refuses to
 * publish an unverified provider — so this panel describes publishing as an
 * outcome, never as a button. Offering a control the database will refuse is
 * how you get a stylist convinced they are live when they are not.
 */

export type IdCheckState = 'none' | 'pending' | 'approved' | 'rejected'

/**
 * The bio length needed to appear on the PUBLIC website. Nothing else.
 *
 * ⚠️ It is NOT a publishing requirement, and an earlier version of this file
 * wrongly made it one. `public_stylists` uses this number to avoid a
 * thin-content manual action from a search crawler indexing a new domain —
 * that reason does not reach the member area, where there is no crawler. A
 * stylist below it is live and bookable; they just do not show on
 * cavybeauty.com. See migration 0016's header.
 *
 * `public-web-views.sql` is the authority. This copy exists only so the panel
 * can say "yours is 13" instead of making someone guess.
 */
export const BIO_MIN_CHARS = 40

/**
 * The key two category names are the SAME category by.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `provider_treatments.category` is free text and does not reliably match
 * `treatment_categories.name`. mobile/src/app/(app)/edit-shop.tsx writes from a
 * hardcoded list containing "Spray Tan"; the database says "Spray tan".
 *
 * That one capital letter made the shop editor unusable for the two providers
 * holding it. The picker seeded its selection from provider_treatments, so
 * "Spray Tan" was in the set; the chips came from treatment_categories, so the
 * "Spray tan" chip tested `selected.has("Spray tan")`, saw false, and rendered
 * OFF. The stylist could not see it, could not untick it, and every save was
 * then rejected as "We don't offer Spray Tan as a category" — naming something
 * they had never touched.
 *
 * ── THE CONVENTION WAS ALREADY THERE ──────────────────────────────────────
 * public-web-views.sql:143 has always joined these two columns on
 * `lower(btrim(tc.name)) = lower(btrim(pt.category))`. The database layer never
 * assumed they agreed. This is that same rule, in the one place the web can
 * share it.
 *
 * Comparison only — never store this. Canonical CASING comes from
 * treatment_categories, so what gets written is the category's real name.
 */
export const categoryKey = (name: string): string => name.trim().toLowerCase()

export interface StylistSetup {
  /** Null only if the signup trigger never made a providers row. */
  providerId: string | null
  name: string | null
  bio: string | null
  locationText: string | null
  /** Name and area both filled in — the minimum a model needs to pick you. */
  detailsDone: boolean
  treatmentCount: number
  /**
   * What is stopping the shop going live, in words. Empty when nothing is.
   *
   * Mirrors provider_shop_is_publishable() (0016): a name, and at least one
   * treatment. Deliberately NOT the same list as `detailsDone` — the area is a
   * quality nudge nothing gates on, and a panel that demands something which
   * is not actually blocking is its own kind of lie.
   */
  publishBlockers: string[]

  /**
   * What is stopping the shop appearing on the PUBLIC website, once it is live.
   *
   * A separate list because it is a separate consequence. Being under the bio
   * bar does not stop a model booking you — it stops you showing on
   * cavybeauty.com. Merging the two would tell a live, bookable stylist they
   * are blocked when they are only invisible to Google.
   *
   * Today this is only ever the bio: public_stylists' other two requirements
   * (a name, a category) are already in publishBlockers.
   */
  websiteBlockers: string[]
  idCheck: IdCheckState
  /** The reviewer's note. On a rejection it is the only thing that makes it fixable. */
  idCheckNote: string | null
  isVerified: boolean
  /** Paid, waived, or founding — any of the three settles the £14.99. */
  feeSettled: boolean
  isFoundingProvider: boolean
  isPublished: boolean
}

export interface ShopEditorData {
  providerId: string
  name: string
  bio: string
  locationText: string
  /** treatment_categories.name values this stylist currently offers. */
  selected: string[]
  /** Every active category, in the app's own order. */
  allCategories: string[]
}

/* ── setup state ───────────────────────────────────────────────────────── */

export async function getStylistSetup(
  supabase: SupabaseClient,
  userId: string,
): Promise<StylistSetup> {
  const { data: provRow } = await supabase
    .from('providers')
    // location as well as location_text: a stylist who has not re-saved since
    // the two columns split has their area only in the dead one, and telling
    // them to fill in something they already filled in is worse than reading a
    // column we would rather retire. Same rule as lib/queries/browse.ts.
    .select('id, name, bio, location_text, location, is_published')
    .eq('user_id', userId)
    .maybeSingle()

  const prov = provRow as {
    id: string; name: string | null; bio: string | null
    location_text: string | null; location: string | null
    is_published: boolean | null
  } | null

  const empty: StylistSetup = {
    providerId: null, name: null, bio: null, locationText: null,
    detailsDone: false, treatmentCount: 0, publishBlockers: [], websiteBlockers: [],
    idCheck: 'none', idCheckNote: null,
    isVerified: false, feeSettled: false, isFoundingProvider: false,
    isPublished: false,
  }
  if (!prov) return empty

  const [treatRes, userRes, payRes, reqRes] = await Promise.all([
    supabase.from('provider_treatments')
      .select('id', { count: 'exact', head: true }).eq('provider_id', prov.id),
    supabase.from('users')
      .select('is_verified, is_founding_provider, provider_fee_waived')
      .eq('id', userId).maybeSingle(),
    supabase.from('verification_payments')
      .select('id').eq('user_id', userId).limit(1).maybeSingle(),
    // Latest first: a rejected request is deleted before a fresh one is filed,
    // but ordering costs nothing and stops a stale row deciding the state.
    supabase.from('verification_requests')
      .select('status, notes, created_at').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const u = (userRes.data ?? {}) as {
    is_verified?: boolean; is_founding_provider?: boolean; provider_fee_waived?: boolean
  }
  const req = reqRes.data as { status: string; notes: string | null } | null

  const locationText = prov.location_text ?? prov.location
  const treatmentCount = treatRes.count ?? 0
  const bioLength = (prov.bio ?? '').trim().length

  // Going live: a name and a treatment. Nothing else, matching 0016.
  const publishBlockers: string[] = []
  if (!prov.name?.trim()) publishBlockers.push('a name for your shop')
  if (treatmentCount === 0) publishBlockers.push('at least one treatment')

  // Showing on cavybeauty.com: the bio bar, and only once they are otherwise
  // live — telling someone about the public website while their shop still has
  // no name is answering a question they have not reached yet.
  const websiteBlockers: string[] = []
  if (publishBlockers.length === 0 && bioLength < BIO_MIN_CHARS) {
    // The number both ways round, so "add a bit more" is actionable.
    websiteBlockers.push(
      bioLength === 0
        ? `a few lines about you — at least ${BIO_MIN_CHARS} characters`
        : `a bit more in your bio — ${BIO_MIN_CHARS} characters at least, yours is ${bioLength}`,
    )
  }

  const idCheck: IdCheckState = u.is_verified
    ? 'approved'
    : req?.status === 'pending' || req?.status === 'rejected'
      ? req.status
      : 'none'

  return {
    providerId: prov.id,
    name: prov.name,
    bio: prov.bio,
    locationText,
    detailsDone: !!prov.name?.trim() && !!locationText?.trim(),
    treatmentCount,
    publishBlockers,
    websiteBlockers,
    idCheck,
    idCheckNote: req?.notes?.trim() ? req.notes.trim() : null,
    isVerified: !!u.is_verified,
    feeSettled: !!payRes.data || !!u.is_founding_provider || !!u.provider_fee_waived,
    isFoundingProvider: !!u.is_founding_provider,
    isPublished: !!prov.is_published,
  }
}

/* ── the editor ────────────────────────────────────────────────────────── */

/** Everything /shop needs to render its two forms. Null for a non-stylist. */
export async function getShopEditorData(
  supabase: SupabaseClient,
  userId: string,
): Promise<ShopEditorData | null> {
  const { data: provRow } = await supabase
    .from('providers')
    .select('id, name, bio, location_text, location')
    .eq('user_id', userId)
    .maybeSingle()

  const prov = provRow as {
    id: string; name: string | null; bio: string | null
    location_text: string | null; location: string | null
  } | null
  if (!prov) return null

  const [mineRes, allRes] = await Promise.all([
    supabase.from('provider_treatments').select('category').eq('provider_id', prov.id),
    supabase.from('treatment_categories')
      .select('name, sort_order').eq('is_active', true).order('sort_order'),
  ])

  const allCategories = ((allRes.data ?? []) as { name: string }[]).map(c => c.name)

  // Map what this provider has onto the CANONICAL names, case-insensitively.
  // Returning the stored spelling instead is what made the "Spray tan" chip
  // unlightable for a provider holding "Spray Tan" — see categoryKey.
  //
  // A stored category matching no active category is dropped rather than
  // returned: there is no chip that could represent it, so including it would
  // put a value in the form that the user cannot see or remove, which is the
  // exact bug this is fixing.
  const canonical = new Map(allCategories.map(n => [categoryKey(n), n]))
  const selected = [...new Set(
    ((mineRes.data ?? []) as { category: string | null }[])
      .map(t => (t.category ? canonical.get(categoryKey(t.category)) : null))
      .filter((c): c is string => !!c),
  )]

  return {
    providerId: prov.id,
    name: prov.name ?? '',
    bio: prov.bio ?? '',
    locationText: prov.location_text ?? prov.location ?? '',
    selected,
    allCategories,
  }
}
