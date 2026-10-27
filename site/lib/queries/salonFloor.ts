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

/**
 * The radius the page opens at, and therefore the radius the dot must use.
 *
 * ⚠️ ONE CONSTANT, READ BY BOTH, BECAUSE A DOT FOR A POST THE PAGE WILL NOT
 * SHOW IS THE EXACT FAILURE AppNav WARNS ABOUT — "'3' next to a list of four
 * is a bug report". If the page defaulted to 20 and the dot asked 'any', a
 * member would tap a lit nav item and arrive at an empty wall.
 *
 * ── ⚠️⚠️ AN OBJECT, NOT A NUMBER, AND THAT IS THE POINT OF IT ───────────
 * This was `= 20`, and the page picked its chip with
 * `String(DEFAULT_FLOOR_RADIUS_MILES)`. Setting the number to null to mean
 * "any distance" would make that `String(null)` → "null", which matches no
 * chip key, so the selection would fall through to the 20-mile chip while the
 * feed actually filtered at any-distance. The control would say one thing and
 * the list would do another.
 *
 * ⚠️ AND WRITING 'any' INTO THE PAGE AS A LITERAL WOULD FIX THE SYMPTOM AND
 * LOSE THE GUARANTEE: the key and the miles would then be two values that
 * happen to agree, which is exactly what this constant exists to prevent. So
 * it carries BOTH, from one literal — the page reads `.key`, the dot reads
 * `.miles`, and they cannot disagree because there is nothing to disagree.
 */
export const DEFAULT_FLOOR_RADIUS = { key: 'any', miles: null } as const

/** The miles half, for callers that only ask "how far". */
export const DEFAULT_FLOOR_RADIUS_MILES: number | null = DEFAULT_FLOOR_RADIUS.miles

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
 * ── ⚠️⚠️ EXPIRY AND APPROVAL ARE FILTERED HERE, AND THE DUPLICATION IS
 * ── DELIBERATE. THIS COMMENT USED TO SAY THE OPPOSITE ───────────────────
 * It said: "Expiry and moderation are NOT filtered here. status_posts_read_visible
 * already enforces both in the database, and re-stating them would be a second
 * copy of a rule that can drift." That is right when RLS applies a rule
 * UNIFORMLY. It does not here. Three permissive policies OR together:
 *
 *   status_posts_read_visible   approved AND expires_at > now()
 *   status_posts_read_own       author_user_id = auth.uid()
 *   status_posts_admin_all      is_admin()
 *
 * So the database deliberately gives a DIFFERENT ANSWER PER ROLE, and there is
 * no single rule left to defer to. Measured 27 Oct 2026: an ordinary member saw
 * 0 posts on this wall and an admin saw 1 — Elisa's, expired the previous day.
 * The person checking whether the product works was reading a page no member
 * could see, which is the worst possible viewer for that to happen to.
 *
 * ── ⚠️ WHAT IS RESTATED IS THE TWO MEMBER-FACING POLICIES, NOT "EVERYTHING"
 * The filter below is `expires_at > now()` AND `(approved OR mine)` — which is
 * `read_visible OR read_own`, written out. The admin policy is the one thing
 * left out, and leaving it out is the entire point.
 *
 * ⚠️⚠️ FILTERING APPROVAL OUTRIGHT WOULD HAVE BROKEN A PROMISE THAT IS ON
 * SCREEN. When a post is held for review, Composer.tsx tells the author:
 * "You'll see it on the floor once it's through, and ONLY YOU CAN SEE IT UNTIL
 * THEN." A bare `moderation_status = 'approved'` makes that sentence false —
 * she would not see it either — and for a MODEL author there is no second
 * place to find it: the stylist dashboard surfaces a held post with its review
 * note (queries/dashboard.ts:312), and nothing does that for a model. So
 * `or mine` is not a nicety; it is what keeps a published sentence true.
 *
 * ── ⚠️ EXPIRY IS FILTERED FOR EVERYONE, INCLUDING THE AUTHOR ────────────
 * That case WAS considered and it went the other way from approval. An expired
 * post is gone for every other member, and showing it to its author among live
 * ones presents it as though it still reaches people. dashboard.ts:312 already
 * made exactly this call for a stylist's own post — it filters expiry while
 * deliberately NOT filtering approval — so this matches a decision the codebase
 * had already taken rather than inventing one.
 *
 * ⚠️ THE BETTER LONG-TERM ANSWER IS TO SHOW IT TO HER LABELLED "Expired", and
 * somebody will want that back. It is not done here because the wall has no
 * per-post state badge and adding one is a design change, not a predicate.
 * Nobody holds an expired post today, so nothing changes for a real person.
 *
 * ── ⚠️ THE PREDICATE IS IN THE QUERY, NOT A .filter() AFTERWARDS ────────
 * `limit(120)` is applied by PostgREST BEFORE anything we could do in
 * JavaScript, so a post-fetch filter would let expired rows eat an admin's row
 * budget and silently shorten the wall as they accumulate. In the query, the
 * 120 counts only rows that can actually be shown.
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
      // ⚠️ See the header. `read_visible OR read_own`, written out, so the
      // admin policy cannot widen this wall for one reader.
      .gt('expires_at', new Date().toISOString())
      .or(`moderation_status.eq.approved,author_user_id.eq.${userId}`)
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

/**
 * Is there anything new on the floor for this member?
 *
 * ── ⚠️ A BOOLEAN, AND THE EXPIRY IS WHY ─────────────────────────────────
 * Posts go after 48 hours, so a count computed when the nav renders can be
 * wrong by the time the member taps it. AppNav's own note: "a count also has
 * to be right, and '3' next to a list of four is a bug report". Messages can
 * carry a number because read_at is per-row and stable. This cannot.
 *
 * ── ⚠️⚠️ IT ANSWERS THE SAME QUESTION getSalonFloor ANSWERS ─────────────
 * Same block list, same distance helper, same radius constant. That is not
 * tidiness: slots.ts's header records what happened when two surfaces each
 * decided "what can she see" for themselves — they agreed only by accident,
 * and correcting one would have made the other advertise what it then refused
 * (audit item 192). A dot is that same promise one step earlier.
 *
 * ── ⚠️⚠️ APPROVAL AND EXPIRY ARE FILTERED HERE, AND THAT IS A DELIBERATE
 * ── DUPLICATION OF A RULE RLS ALREADY APPLIES ──────────────────────────
 * `getSalonFloor` does NOT restate those predicates, and is right not to:
 * `status_posts_read_visible` applies them on every read, and a second copy of
 * a rule the database enforces uniformly is a second thing to drift.
 *
 * ⚠️ BUT IT IS NOT UNIFORM HERE. Three PERMISSIVE policies OR together:
 *
 *   status_posts_read_visible   approved AND expires_at > now()
 *   status_posts_read_own       author_user_id = auth.uid()
 *   status_posts_admin_all      is_admin()
 *
 * So RLS deliberately gives DIFFERENT ANSWERS TO DIFFERENT ROLES, and there is
 * no single rule left to defer to. An admin is shown expired and unapproved
 * posts; a member is not. Deferring would make this dot mean one thing for two
 * accounts and another thing for everyone else — and those two accounts are
 * the ones looking at it most, so they would be reading a signal nobody else
 * gets and calibrating the product against it.
 *
 * ✅ AN ORDINARY MEMBER GETS THE SAME ANSWER EITHER WAY. The filter changes
 * nothing for them; it exists so that an admin gets that answer too.
 *
 * ⚠️ The author exclusion below is a separate matter and stays regardless:
 * `status_posts_read_own` means you always see your own posts, and without it
 * posting something would light your own dot.
 *
 * ── ⚠️ NULL seenAt MEANS "NEVER LOOKED", WHICH IS 0104's RULE INVERTED ──
 * The admin console seeds its watermarks at now() so a first load is not a
 * wall of dots over data that was always there. Here a null means every
 * visible post counts as new, and that is a decision rather than an
 * inconsistency: the worst case is ONE dot for a post under 48 hours old that
 * she may already have seen, and erring toward drawing attention is the whole
 * point of a feature that says "somebody is on the floor". The cost of being
 * wrong is opposite in the two places, so the rule is too.
 *
 * ⚠️ FAILS TO `false`. A dot invented by a broken read sends someone to an
 * empty wall; a dot missed costs them nothing they can see. The nav's own
 * try/catch is the second half of this.
 */
export async function hasNewFloorPosts(
  supabase: SupabaseClient,
  userId: string,
  seenAt: string | null,
): Promise<boolean> {
  let q = supabase
    .from('status_posts')
    .select('id, created_at, author_user_id')
    // ⚠️ THE DELIBERATE DUPLICATION. See the header: RLS is role-dependent on
    // this table, so these two predicates are what make the dot mean the same
    // thing for an admin as for everybody else. They are a no-op for an
    // ordinary member, whose RLS has already applied them.
    .eq('moderation_status', 'approved')
    .gt('expires_at', new Date().toISOString())
    // ⚠️ NOT MINE. See above — this is about somebody else having spoken.
    .neq('author_user_id', userId)
    .order('created_at', { ascending: false })
    // Enough to survive the block and radius filters below without reading the
    // whole wall. The answer is a boolean, so this only has to find ONE.
    .limit(60)

  // A null watermark means never looked, so no lower bound at all.
  if (seenAt) q = q.gt('created_at', seenAt)

  const [{ data: postRows, error }, { data: me }, blocked] = await Promise.all([
    q,
    supabase.from('users').select('latitude, longitude').eq('id', userId).maybeSingle(),
    getBlockedIds(supabase, userId).catch(() => new Set<string>()),
  ])
  if (error) {
    console.warn('[salonFloor] hasNewFloorPosts failed:', error.message)
    return false
  }

  const rows = ((postRows ?? []) as Pick<PostRow, 'id' | 'created_at' | 'author_user_id'>[])
    .filter(r => !blocked.has(r.author_user_id))
  if (rows.length === 0) return false

  const authorIds = [...new Set(rows.map(r => r.author_user_id))]
  const { data: coords } = await supabase
    .from('users').select('id, latitude, longitude').in('id', authorIds)

  const coordOf = new Map<string, { latitude: number | null; longitude: number | null }>()
  for (const c of (coords ?? []) as {
    id: string; latitude: number | null; longitude: number | null
  }[]) coordOf.set(c.id, { latitude: c.latitude, longitude: c.longitude })

  // ⚠️ THE SAME HELPER, NOT THE SAME ARITHMETIC WRITTEN AGAIN. withinRadius
  // also decides that a viewer with no coordinates gets NO filter — the rule
  // is `radiusApplied = hasLoc ? radiusMiles : null` — so this inherits
  // getSalonFloor's behaviour for a member who has set no postcode instead of
  // reproducing it.
  const placed = withinRadius(
    rows,
    (me ?? null) as { latitude: number | null; longitude: number | null } | null,
    r => {
      const c = coordOf.get(r.author_user_id)
      return { lat: c?.latitude ?? null, lng: c?.longitude ?? null }
    },
    DEFAULT_FLOOR_RADIUS_MILES,
  )

  return placed.items.length > 0
}
