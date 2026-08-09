import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { indexById, displayName, type ProfileRef } from './util'

/**
 * A stylist's profile, read as an authenticated member.
 *
 * ── READS BASE TABLES, NOT public_stylists ─────────────────────────────────
 * Deliberate, and worth stating because the anon view exists and looks handy.
 * The authenticated half goes through the same RLS the mobile app uses, so
 * nothing here needs a grant and no new anon exposure is created.
 *
 * In particular: `public_stylist_portfolio` and `public_stylist_reviews` remain
 * UNGRANTED. Rendering portfolios and reviews here must never become the
 * argument for granting them to anon — those still need the §8 consent basis,
 * because the anon surface publishes to the open web and this one does not.
 *
 * ── ONE PLACE THIS DELIBERATELY DIVERGES FROM MOBILE ───────────────────────
 * mobile/src/app/(app)/provider/[id].tsx:151 selects `location`, the dead
 * legacy column that nothing writes any more — which is why the location is
 * blank on every mobile shop page for anyone who saved via edit-shop. It is a
 * known bug, logged in the phase-1 plan.
 *
 * Copying it for the sake of parity would be copying a bug. This coalesces
 * location_text over location, so the web page shows a location where mobile
 * shows nothing. If the mobile one-word fix ever lands, the coalesce keeps
 * working unchanged.
 */

export interface StylistProfile {
  id: string
  userId: string | null
  name: string
  bio: string | null
  location: string | null
  level: string | null
  isVerified: boolean
  rating: number | null
  reviewCount: number
  avatarUrl: string | null
  bannerUrl: string | null
  categories: string[]
  portfolio: { id: string; mediaUrl: string; mediaType: string | null }[]
  /** Own uploads still awaiting moderation. Only ever populated for the owner. */
  pendingPortfolio: { id: string; mediaUrl: string; mediaType: string | null }[]
  /** The viewer is this stylist. Changes wording and reveals pending uploads. */
  isOwner: boolean
  reviews: {
    id: string
    rating: number | null
    comment: string | null
    tags: string[] | null
    createdAt: string
    reviewerName: string
  }[]
  /** Blocked either direction. The page says so rather than pretending. */
  isBlocked: boolean
  /** Dates in the next 60 days with an unbooked slot. */
  openDates: string[]
}

export async function getStylistProfile(
  supabase: SupabaseClient,
  providerId: string,
  viewerId: string,
): Promise<StylistProfile | null> {
  const { data: p } = await supabase
    .from('providers')
    .select(
      'id, user_id, name, bio, location_text, location, level, is_verified, ' +
      'rating, review_count, profile_pic_url, banner_url',
    )
    .eq('id', providerId)
    .maybeSingle()
  if (!p) return null

  const prov = p as unknown as {
    id: string; user_id: string | null; name: string | null
    bio: string | null; location_text: string | null; location: string | null
    level: string | null; is_verified: boolean | null
    rating: number | null; review_count: number | null
    profile_pic_url: string | null; banner_url: string | null
  }

  const today = new Date().toISOString().slice(0, 10)
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

  const [treatRes, portRes, revRes, blocked, availRes] = await Promise.all([
    // Category is the only column edit-shop reliably fills; `name` holds a copy
    // and duration/price are never written. Same note as mobile.
    supabase.from('provider_treatments').select('category').eq('provider_id', providerId),
    // No moderation filter here: the split happens below, so the OWNER can see
    // their own pending uploads. RLS still decides what is readable at all.
    supabase.from('portfolio_items')
      .select('id, media_url, media_type, moderation_status')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false }),
    supabase.from('reviews')
      .select('id, overall_rating, comment, tags, created_at, reviewer_id')
      .eq('reviewee_id', prov.user_id ?? '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false })
      .limit(20),
    getBlockedIds(supabase, viewerId).catch(() => new Set<string>()),
    supabase.from('availability')
      .select('date, is_taken').eq('provider_id', providerId)
      .gte('date', today).lte('date', in60),
  ])

  const isOwner = !!prov.user_id && prov.user_id === viewerId
  const portRows = (portRes.data ?? []) as {
    id: string; media_url: string; media_type: string | null; moderation_status: string | null
  }[]

  const reviewRows = (revRes.data ?? []) as {
    id: string; overall_rating: number | null; comment: string | null
    tags: string[] | null; created_at: string; reviewer_id: string | null
  }[]

  // Reviewer names come from public_profiles — users RLS blocks reading other
  // people's rows directly, and a review with no attribution reads as fake.
  const reviewerIds = [...new Set(reviewRows.map(r => r.reviewer_id).filter(Boolean) as string[])]
  const namesRes = reviewerIds.length > 0
    ? await supabase.from('public_profiles')
        .select('id, first_name, last_initial, profile_pic_url').in('id', reviewerIds)
    : { data: [] }
  const nameMap = indexById<ProfileRef>(namesRes.data)

  return {
    id: prov.id,
    userId: prov.user_id,
    name: prov.name ?? 'Stylist',
    bio: prov.bio,
    // See the header: location_text is the live column, location is the dead one.
    location: prov.location_text ?? prov.location ?? null,
    level: prov.level,
    isVerified: !!prov.is_verified,
    rating: prov.rating,
    reviewCount: prov.review_count ?? 0,
    avatarUrl: prov.profile_pic_url,
    bannerUrl: prov.banner_url,
    categories: [...new Set(
      ((treatRes.data ?? []) as { category: string | null }[])
        .map(t => t.category).filter(Boolean) as string[],
    )],
    portfolio: portRows.filter(i => i.moderation_status === 'approved')
      .map(i => ({ id: i.id, mediaUrl: i.media_url, mediaType: i.media_type })),
    // Shown to the owner only. Everyone else must not learn that an item is
    // sitting in a queue, let alone see it.
    pendingPortfolio: isOwner
      ? portRows.filter(i => i.moderation_status !== 'approved')
          .map(i => ({ id: i.id, mediaUrl: i.media_url, mediaType: i.media_type }))
      : [],
    isOwner,
    reviews: reviewRows.map(r => ({
      id: r.id,
      rating: r.overall_rating,
      comment: r.comment,
      tags: r.tags,
      createdAt: r.created_at,
      reviewerName: displayName(r.reviewer_id ? nameMap[r.reviewer_id] : undefined, 'A member'),
    })),
    isBlocked: !!(prov.user_id && blocked.has(prov.user_id)),
    openDates: [...new Set(
      ((availRes.data ?? []) as { date: string; is_taken: boolean | null }[])
        .filter(a => !a.is_taken).map(a => a.date),
    )].sort(),
  }
}
