import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'

/**
 * Browse published stylists.
 *
 * ── USEFUL WITH NO LOCATION, BY DESIGN ────────────────────────────────────
 * A web-only signup has no latitude or longitude — nothing sets one until the
 * app does — and that is the DEFAULT state for anyone who never installs it.
 * So this must not be a distance-sorted list that degrades to empty; distance
 * is an enhancement that lands later.
 *
 * What replaces it for now is a plain text match on the stylist's own
 * location_text. Typing "Bromley" needs no permission prompt, no geocoding
 * dependency, and is more precise than a browser fix — which is also why the
 * manual box stays the primary path once coordinates arrive rather than
 * becoming a fallback nobody sees.
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
  level: string | null
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
}

export async function getBrowseStylists(
  supabase: SupabaseClient,
  viewerId: string,
  filters: BrowseFilters = {},
): Promise<BrowseStylist[]> {
  let q = supabase
    .from('providers')
    .select('id, user_id, name, bio, location_text, location, level, is_verified, rating, review_count, profile_pic_url')
    .eq('is_published', true)

  if (filters.place?.trim()) {
    const p = filters.place.trim().replace(/[%,()]/g, '')
    if (p) q = q.or(`location_text.ilike.%${p}%,location.ilike.%${p}%`)
  }

  const [provRes, blocked] = await Promise.all([
    q,
    getBlockedIds(supabase, viewerId).catch(() => new Set<string>()),
  ])

  const rows = (provRes.data ?? []) as {
    id: string; user_id: string | null; name: string | null; bio: string | null
    location_text: string | null; location: string | null; level: string | null
    is_verified: boolean | null; rating: number | null; review_count: number | null
    profile_pic_url: string | null
  }[]
  const visible = rows.filter(r => !(r.user_id && blocked.has(r.user_id)))
  if (visible.length === 0) return []

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

  return visible
    .map((r): BrowseStylist => ({
      id: r.id,
      name: r.name ?? 'Stylist',
      bio: r.bio,
      location: r.location_text ?? r.location ?? null,
      level: r.level,
      isVerified: !!r.is_verified,
      rating: r.rating,
      reviewCount: r.review_count ?? 0,
      avatarUrl: r.profile_pic_url,
      categories: [...(cats.get(r.id) ?? [])].sort(),
      hasOpenSlots: openSlots.has(r.id),
    }))
    .filter(s => !filters.category || s.categories.includes(filters.category))
    // Bookable first. Without distance, "can I actually get an appointment"
    // is the most useful thing to sort on — a five-star stylist with no slots
    // is not a result anyone wanted. Rating breaks the tie, and only where
    // there are reviews behind it.
    .sort((a, b) =>
      Number(b.hasOpenSlots) - Number(a.hasOpenSlots) ||
      (b.reviewCount > 0 ? (b.rating ?? 0) : -1) - (a.reviewCount > 0 ? (a.rating ?? 0) : -1) ||
      a.name.localeCompare(b.name),
    )
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
