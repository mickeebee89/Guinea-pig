import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { withinRadius } from '@/lib/distance'

/**
 * The Salon Floor: one wall, both roles. Audit item 141.
 *
 * ── WHY A WALL AND NOT STYLIST-SIDE BROWSE ──────────────────────────────
 * A stylist who signs up has nothing to do until somebody applies to her. The
 * obvious answer was a browsable list of models; the answer chosen was a shared
 * wall, because **a model appears here because she posted, not because she
 * exists.** That makes it opt-in by construction and leaves no privacy question
 * to answer afterwards.
 *
 * It is worth knowing that browse would not have granted new access — every
 * part of a model's profile is already readable by any signed-in account
 * (`public_profiles` has no WHERE clause; `model_attributes` and `model_photos`
 * are both `using (true)`). It would have turned "if you know the id" into
 * "here are 200, filterable", which is a real difference even though the access
 * rules are identical. The wall never raises it.
 *
 * ── ONE AUDIENCE, AND THE PAGE SAYS SO ──────────────────────────────────
 * There is no stylists-only or models-only view. `status_posts_read_visible` is
 * `approved and unexpired` with no role condition, so every member sees every
 * post, and the 48-hour expiry is the only limit on reach. The page copy states
 * that where somebody is about to type, rather than leaving it to be discovered.
 */

export type FloorPost = {
  id: string
  body: string
  createdAt: string
  authorUserId: string
  authorName: string
  authorAvatar: string | null
  /** The shop, when a stylist wrote it. Null for a model's post. */
  providerId: string | null
  isMine: boolean
  /** Null when either party has no coordinates. */
  distanceMiles: number | null
}

export type FloorFeed = {
  posts: FloorPost[]
  viewerHasLocation: boolean
  radiusApplied: number | null
  /** How many the radius removed. See the note in lib/distance.ts. */
  unplaceableHidden: number
}

type PostRow = {
  id: string
  body: string
  created_at: string
  author_user_id: string
  provider_id: string | null
}

/**
 * Approved, unexpired posts within the radius.
 *
 * ⚠️ BLOCKED EITHER WAY, SERVER-SIDE. `getBlockedIds` is the same path browse
 * uses. The app's nearby-models strip filtered blocks in JavaScript for months
 * and the web is not repeating it: a control that only hides somebody from one
 * list is the kind people stop trusting.
 *
 * Expiry and moderation are NOT filtered here. `status_posts_read_visible`
 * already enforces both in the database, and re-stating them in the query would
 * be a second copy of a rule that can drift from the first.
 */
export async function getSalonFloor(
  supabase: SupabaseClient,
  userId: string,
  radiusMiles: number | null,
): Promise<FloorFeed> {
  const [{ data: postRows }, { data: me }, blocked] = await Promise.all([
    supabase
      .from('status_posts')
      .select('id, body, created_at, author_user_id, provider_id')
      .order('created_at', { ascending: false })
      .limit(120),
    supabase.from('users').select('latitude, longitude').eq('id', userId).maybeSingle(),
    getBlockedIds(supabase, userId).catch(() => new Set<string>()),
  ])

  const rows = ((postRows ?? []) as PostRow[]).filter(r => !blocked.has(r.author_user_id))
  if (rows.length === 0) {
    return {
      posts: [],
      viewerHasLocation: (me as { latitude: number | null } | null)?.latitude != null,
      radiusApplied: null,
      unplaceableHidden: 0,
    }
  }

  // Avatar and name only. Nothing else about the author belongs on the wall —
  // a post is a thing somebody said, not a profile card.
  const authorIds = [...new Set(rows.map(r => r.author_user_id))]
  const [{ data: authors }, { data: coords }] = await Promise.all([
    supabase.from('public_profiles')
      .select('id, first_name, last_initial, profile_pic_url')
      .in('id', authorIds),
    supabase.from('users').select('id, latitude, longitude').in('id', authorIds),
  ])

  const nameOf = new Map<string, { name: string; avatar: string | null }>()
  for (const a of (authors ?? []) as {
    id: string; first_name: string | null; last_initial: string | null; profile_pic_url: string | null
  }[]) {
    const first = (a.first_name ?? '').trim()
    const initial = (a.last_initial ?? '').trim()
    nameOf.set(a.id, {
      name: [first, initial ? initial + '.' : ''].filter(Boolean).join(' ') || 'A member',
      avatar: a.profile_pic_url,
    })
  }

  const coordOf = new Map<string, { latitude: number | null; longitude: number | null }>()
  for (const c of (coords ?? []) as {
    id: string; latitude: number | null; longitude: number | null
  }[]) coordOf.set(c.id, { latitude: c.latitude, longitude: c.longitude })

  const viewer = (me ?? null) as { latitude: number | null; longitude: number | null } | null
  // The rows never carry lat/lng themselves — coordinates come from coordOf —
  // so there is nothing to strip afterwards and withoutCoords is not needed.
  const placed = withinRadius(
    rows,
    viewer,
    r => {
      const c = coordOf.get(r.author_user_id)
      return { lat: c?.latitude ?? null, lng: c?.longitude ?? null }
    },
    radiusMiles,
  )

  return {
    posts: placed.items.map(r => {
      const who = nameOf.get(r.author_user_id)
      return {
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        authorUserId: r.author_user_id,
        authorName: who?.name ?? 'A member',
        authorAvatar: who?.avatar ?? null,
        providerId: r.provider_id,
        isMine: r.author_user_id === userId,
        distanceMiles: r.distanceMiles,
      }
    }),
    viewerHasLocation: placed.viewerHasLocation,
    radiusApplied: placed.radiusApplied,
    unplaceableHidden: placed.unplaceableHidden,
  }
}
