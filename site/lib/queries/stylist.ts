import type { SupabaseClient } from '@supabase/supabase-js'
import { withoutStartedSlots } from '@/lib/slots'
import { getBlockedIds } from '@/lib/blocks'
// ⚠️ `providers.level` IS GONE FROM EVERY SURFACE — item 105, 24 Sep 2026.
//
// It rendered as a grey chip beside the pink Verified badge, showing the raw
// stored string. What was actually in the column:
//
//   * NULL for every stylist created by the signup trigger (0011:168, the
//     normal path) — so no chip at all;
//   * 'beginner' only for rows created by mobile's FALLBACK insert
//     (provider-dashboard.tsx:337).
//
// So it was not "every stylist is labelled a beginner". It was an arbitrary
// subset carrying a label nobody chose, decided by which code path happened to
// create the row, and invisible to both the stylist and the model.
//
// Removed rather than fixed, and the reason is not that it went stale:
//
//   1. It was the ONLY claim on that profile the product asserted ABOUT a
//      person rather than taking from her or from her work. Name, bio, photo
//      and treatments are hers; rating, review count and Verified are earned.
//   2. Both honest replacements already exist on the page. Self-set is what
//      the BIO is, in her own words. Derived-from-work is what the RATING and
//      REVIEW COUNT are. A third signal competing with two better ones.
//
// The column is still there and is dropped in a later migration, sequenced
// behind this deploy — the same order 0055 needed.

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

/**
 * ⚠️ THE EMBED'S SHAPE IS NOT AGREED, SO BOTH ARE HANDLED. Item 176.
 *
 * `users!user_id(is_verified)` is a many-to-one FK, and PostgREST returns a
 * single object for it at runtime — admin/app/providers/page.tsx types it that
 * way and has worked in production. But the GENERATED TYPES model it as an
 * ARRAY, so TypeScript and the runtime disagree about which it is.
 *
 * Reading `.is_verified` off the wrong one yields `undefined`, which is falsy,
 * which is a badge that silently does not show — the exact failure this change
 * exists to end. So neither shape is assumed.
 */
function embeddedVerified(u: unknown): boolean {
  const row = Array.isArray(u) ? u[0] : u
  return !!(row as { is_verified?: boolean | null } | null | undefined)?.is_verified
}

export interface StylistProfile {
  id: string
  userId: string | null
  name: string
  bio: string | null
  location: string | null
  isVerified: boolean
  /**
   * False when the shop is hidden. Since 0048 a member holding a booking can
   * read the row, so this page now has to render a shop that is not taking
   * bookings — where before it could only ever be looking at a live one.
   */
  isPublished: boolean
  rating: number | null
  reviewCount: number
  avatarUrl: string | null
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
  /**
   * The viewer has saved this stylist.
   *
   * Not a bookmark: the row is what subscribes her to `new_availability`
   * notifications (notifyFavourites). See favourite-actions.ts.
   */
  isFavourite: boolean
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
      // ⚠️ users!user_id(is_verified), NOT providers.is_verified — item 176,
      // 6 Oct 2026. providers.is_verified defaults to false and nothing has
      // ever written it, so the badge on this page had never once shown for a
      // stylist who passed her ID check. admin_decide_verification writes
      // users.is_verified; that is the authoritative one.
      //
      // This page cannot read public_stylists instead: that view withholds
      // user_id and is_published (both used below), and it is a definer view
      // granted to anon, so a signed-in page reading it would bypass RLS.
      // The embed is the same shape admin/app/providers/page.tsx already uses.
      'id, user_id, name, bio, location_text, location, is_published, ' +
      'rating, review_count, profile_pic_url, users!user_id(is_verified)',
    )
    .eq('id', providerId)
    .maybeSingle()
  if (!p) return null

  const prov = p as unknown as {
    id: string; user_id: string | null; name: string | null
    bio: string | null; location_text: string | null; location: string | null
    is_published: boolean | null
    users: unknown
    rating: number | null; review_count: number | null
    profile_pic_url: string | null
  }

  const today = new Date().toISOString().slice(0, 10)
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

  const [treatRes, portRes, revRes, blocked, availRes, favRes] = await Promise.all([
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
      // start_time is selected ONLY so the shared helper can drop slots that
      // have already begun; the calendar itself renders dates. Item 133.
      .select('date, start_time, is_taken').eq('provider_id', providerId)
      .gte('date', today).lte('date', in60),
    // maybeSingle rather than a count: nothing here proves the table has a
    // unique index on the pair, and a count would turn a duplicate row into a
    // wrong-looking number rather than a saved stylist.
    supabase.from('favourites')
      .select('id').eq('user_id', viewerId).eq('provider_id', providerId)
      .maybeSingle(),
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
    isVerified: embeddedVerified(prov.users),
    isPublished: !!prov.is_published,
    rating: prov.rating,
    reviewCount: prov.review_count ?? 0,
    avatarUrl: prov.profile_pic_url,
    categories: [...new Set(
      ((treatRes.data ?? []) as { category: string | null }[])
        .map(t => t.category).filter(Boolean) as string[],
    )],
    // ⚠️ APPROVED VIDEO ROWS ARE EXCLUDED (item 111). Video was removed from
    // the product on 24 Sep 2026 and nothing can play one, so a row approved
    // before then would be a tile that does not work on a profile a model is
    // deciding from. Her own portfolio page still shows it, with a line
    // telling her to remove it — hidden here, visible to her.
    portfolio: portRows
      .filter(i => i.moderation_status === 'approved' && i.media_type !== 'video')
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
    isFavourite: !!favRes.data,
    // A day stops being pale pink once its last slot has begun, rather than
    // at midnight. Item 133.
    openDates: [...new Set(
      withoutStartedSlots(
        (availRes.data ?? []) as {
          date: string; start_time: string; is_taken: boolean | null
        }[],
        a => ({ date: a.date, startTime: a.start_time }),
      ).filter(a => !a.is_taken).map(a => a.date),
    )].sort(),
  }
}
