import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { categoryKey } from '@/lib/queries/shop'
import { withinRadius, withoutCoords, type Placed } from '@/lib/distance'

/**
 * Browse published stylists.
 *
 * ── STILL USEFUL WITH NO LOCATION, WHICH IS THE WHOLE CONSTRAINT ───────
 * ~~A web-only signup has no latitude or longitude — nothing sets one until
 * the app does — ... distance is an enhancement that lands later.~~
 * *Superseded 23 Sep 2026 (item 92). The website can set a coordinate now, so
 * distance has landed — but the sentence that mattered still holds and is the
 * reason the text box below did not go anywhere.*
 *
 * A member who has not set a postcode still has no coordinate, and that is a
 * normal state rather than a broken one. So the radius is an ADDITION to this
 * page and never a precondition for it: with no postcode the distance
 * controls are inert and visibly so, and the list is exactly what it was
 * before. **The one thing this must never become is a distance-sorted list
 * that degrades to empty**, which is precisely what the updates feed had been
 * doing in silence until item 90.
 *
 * The plain text match on the stylist's own location_text stays, and stays
 * PRIMARY. Typing "Bromley" needs no permission prompt, no geocoding
 * dependency, and no postcode — it is the only location filter that works for
 * someone who has given us nothing, and it is how she searches somewhere she
 * is travelling to rather than somewhere she lives. A radius cannot do that.
 *
 * ── location_text, WITH location AS A FALLBACK ────────────────────────────
 * providers carries both. location_text is the live column that edit-shop
 * writes; location is the dead legacy one that only the mobile shop page still
 * reads, which is why locations look blank there. Matching on both means a
 * stylist who has not re-saved since the split is still findable.
 *
 * Reads base tables through RLS — the same "published or own" policy the app
 * uses. NOT public_stylists: that view exists for the anon half and granting
 * more to it is not something a member-area feature should ever motivate.
 */

export interface BrowseStylist {
  id: string
  name: string
  bio: string | null
  location: string | null
  isVerified: boolean
  rating: number | null
  reviewCount: number
  avatarUrl: string | null
  categories: string[]
  /** Has at least one unbooked slot in the next 60 days. */
  hasOpenSlots: boolean
}

export interface BrowseFilters {
  /** treatment_categories.name, or undefined for all. */
  category?: string
  /** Free text matched against the stylist's own location wording. */
  place?: string
  /**
   * Miles, or null for no limit. IGNORED when the viewer has no coordinate —
   * see lib/distance.ts. Passing a number is a request, not an instruction.
   */
  within?: number | null
}

/**
 * The list, plus why it is the length it is.
 *
 * ⚠️ A BARE ARRAY IS NOT ENOUGH ANY MORE. Three different facts can shorten
 * this page and they need different sentences: nobody matched, a radius
 * removed people we could not place, or the radius was never applied because
 * we cannot place HER. The old signature could say none of them.
 */
export type BrowseResult = Placed<BrowseStylist>

export async function getBrowseStylists(
  supabase: SupabaseClient,
  viewerId: string,
  filters: BrowseFilters = {},
): Promise<BrowseResult> {
  let q = supabase
    .from('providers')
    .select('id, user_id, name, bio, location_text, location, is_verified, rating, review_count, profile_pic_url, latitude, longitude')
    .eq('is_published', true)

  if (filters.place?.trim()) {
    const p = filters.place.trim().replace(/[%,()]/g, '')
    if (p) q = q.or(`location_text.ilike.%${p}%,location.ilike.%${p}%`)
  }

  const [provRes, blocked, meRes] = await Promise.all([
    q,
    getBlockedIds(supabase, viewerId).catch(() => new Set<string>()),
    // Her own coordinate. Read here rather than passed in, so no caller can
    // hand this function a location that is not the viewer's.
    supabase.from('users').select('latitude, longitude').eq('id', viewerId).maybeSingle(),
  ])
  const me = meRes.data as { latitude: number | null; longitude: number | null } | null

  const rows = (provRes.data ?? []) as {
    id: string; user_id: string | null; name: string | null; bio: string | null
    location_text: string | null; location: string | null
    is_verified: boolean | null; rating: number | null; review_count: number | null
    profile_pic_url: string | null
    latitude: number | null; longitude: number | null
  }[]
  const visible = rows
    .filter(r => !(r.user_id && blocked.has(r.user_id)))
    // CONTENT BAR — deliberately NARROWER than public_stylists'.
    //
    // The symptom this exists for was live: six providers published and
    // verified with no name at all, each rendering here as a card labelled
    // "Stylist" via the `?? 'Stylist'` fallback below. Kept even after 0016
    // stops that at the source, because is_published is one boolean away from
    // being wrong again and a blank card in a list of people you are choosing a
    // stranger from is worse than a shorter list.
    //
    // ── WHY NOT public_stylists' 40-CHARACTER BIO BAR ─────────────────────
    // Because the REASON for it does not transfer. That threshold protects
    // against a thin-content manual action from a search crawler indexing a new
    // domain. There is no crawler behind the auth gate.
    //
    // What matters in a signed-in list is that a card is not blank. A stylist
    // with a name, treatments and a two-line bio is a real shop a model can
    // usefully book; hiding them from members to satisfy an SEO rule would take
    // a bookable stylist off the page for a reason that has nothing to do with
    // the person looking.
    //
    // Copying the number without checking the reason travelled with it is the
    // same error as having two thresholds, wearing the opposite hat.
    .filter(r => !!r.name?.trim())
  if (visible.length === 0) {
    return { items: [], viewerHasLocation: me?.latitude != null, radiusApplied: null, unplaceableHidden: 0 }
  }

  const ids = visible.map(r => r.id)
  const today = new Date().toISOString().slice(0, 10)
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

  const [treatRes, availRes] = await Promise.all([
    supabase.from('provider_treatments').select('provider_id, category').in('provider_id', ids),
    supabase.from('availability')
      .select('provider_id, is_taken').in('provider_id', ids)
      .gte('date', today).lte('date', in60),
  ])

  const cats = new Map<string, Set<string>>()
  for (const t of (treatRes.data ?? []) as { provider_id: string; category: string | null }[]) {
    if (!t.category) continue
    if (!cats.has(t.provider_id)) cats.set(t.provider_id, new Set())
    cats.get(t.provider_id)!.add(t.category)
  }

  const openSlots = new Set(
    ((availRes.data ?? []) as { provider_id: string; is_taken: boolean | null }[])
      .filter(a => !a.is_taken).map(a => a.provider_id),
  )

  const shaped = visible
    .map((r) => ({
      id: r.id,
      name: r.name ?? 'Stylist',
      bio: r.bio,
      location: r.location_text ?? r.location ?? null,
      isVerified: !!r.is_verified,
      rating: r.rating,
      reviewCount: r.review_count ?? 0,
      avatarUrl: r.profile_pic_url,
      categories: [...(cats.get(r.id) ?? [])].sort(),
      hasOpenSlots: openSlots.has(r.id),
      lat: r.latitude,
      lng: r.longitude,
    }))
    // Third leg of the content bar. Split from the two above only because
    // categories are not known until the treatments query has run.
    .filter(s => s.categories.length > 0)
    // Case-insensitive, matching public-web-views.sql:143 and categoryKey. An
    // exact match here silently dropped every provider whose stored casing
    // differed from the filter's — filtering by "Spray tan" found nobody
    // holding "Spray Tan", with no way for either party to notice.
    .filter(s =>
      !filters.category ||
      s.categories.some(c => categoryKey(c) === categoryKey(filters.category!)),
    )

  const placed = withinRadius(shaped, me, s => ({ lat: s.lat, lng: s.lng }), filters.within ?? null)

  return {
    ...placed,
    items: placed.items
      .map(withoutCoords)
      // ⚠️ BOOKABLE STILL COMES FIRST, AND DISTANCE SLOTS IN BEHIND IT.
      //
      // The original comment said "Without distance, 'can I actually get an
      // appointment' is the most useful thing to sort on" — which correctly
      // anticipated that distance would arrive and change the question. It
      // does not change it as much as it looks:
      //
      //   * this page exists to end in an application, and a stylist with no
      //     open slots CANNOT be applied to at all. Nearest-and-unbookable is
      //     not a better result than three-miles-further-and-free;
      //   * distance then decides among the ones she can actually book, which
      //     is where it earns its place.
      //
      // Deliberately different from mobile, which sorts purely by distance —
      // its list is not filtered to bookable, so it has no such first leg. And
      // from the updates feed, where nearest-first is the whole point.
      .sort((a, b) =>
        Number(b.hasOpenSlots) - Number(a.hasOpenSlots) ||
        (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity) ||
        (b.reviewCount > 0 ? (b.rating ?? 0) : -1) - (a.reviewCount > 0 ? (a.rating ?? 0) : -1) ||
        a.name.localeCompare(b.name),
      ),
  }
}

/** The category filter list. Active categories only, in the app's own order. */
export async function getCategories(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from('treatment_categories')
    .select('name, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order')
  return ((data ?? []) as { name: string }[]).map(c => c.name)
}
