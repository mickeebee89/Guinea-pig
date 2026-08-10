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
 * The bio length a shop needs before it can be published.
 *
 * ⚠️ NOT the authority. `provider_profile_is_complete()` (migration 0016) is,
 * and `public_stylists` gates the open web on the same number. This copy exists
 * only so the panel can say "yours is 12" instead of making the stylist press
 * save to find out.
 *
 * Two thresholds for one idea is precisely how `location` and `location_text`
 * happened — both plausible, both live, silently disagreeing. If this should be
 * 60, it changes here, in 0016 and in public-web-views.sql in one commit, or
 * not at all.
 */
export const BIO_MIN_CHARS = 40

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
   * What is stopping publication, in words, or empty when nothing is.
   *
   * Mirrors provider_profile_is_complete() (0016). Deliberately NOT the same
   * list as `detailsDone`: publication needs a name, a bio and a treatment;
   * the area is a quality nudge the database does not gate on. Conflating the
   * two would have the panel demand something that is not actually blocking,
   * which is its own kind of lie.
   */
  publishBlockers: string[]
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
    detailsDone: false, treatmentCount: 0, publishBlockers: [],
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

  // Says the number both ways round — what is needed and what they have — so
  // "add a bit more" is actionable rather than a guessing game.
  const publishBlockers: string[] = []
  if (!prov.name?.trim()) publishBlockers.push('a name for your shop')
  if (bioLength < BIO_MIN_CHARS) {
    publishBlockers.push(
      bioLength === 0
        ? `a few lines about you (at least ${BIO_MIN_CHARS} characters)`
        : `a bit more in your bio — ${BIO_MIN_CHARS} characters at least, yours is ${bioLength}`,
    )
  }
  if (treatmentCount === 0) publishBlockers.push('at least one treatment')

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

  const selected = [...new Set(
    ((mineRes.data ?? []) as { category: string | null }[])
      .map(t => t.category).filter((c): c is string => !!c),
  )]

  return {
    providerId: prov.id,
    name: prov.name ?? '',
    bio: prov.bio ?? '',
    locationText: prov.location_text ?? prov.location ?? '',
    selected,
    allCategories: ((allRes.data ?? []) as { name: string }[]).map(c => c.name),
  }
}
