import type { SupabaseClient } from '@supabase/supabase-js'
import { indexById, displayName, type ProviderRef, type ProfileRef, type TreatmentRef } from './util'

/**
 * Everything both dashboards need, in one place.
 *
 * Ported from mobile/src/app/(app)/index.tsx (model) and provider-dashboard.tsx
 * (stylist). Content parity is the goal; layout is not — desktop is a different
 * shape and a stretched phone screen was the reason for a separate Next app.
 *
 * ── availability, NOT provider_availability ───────────────────────────────
 * Both tables exist with identical shape. mobile/src/lib/availability.ts and
 * apply-session.tsx both read `availability`, so that is the live one and
 * provider_availability is dead weight — the same duplication as
 * location/location_text. Checked before writing rather than guessed.
 */

const todayIso = () => new Date().toISOString().slice(0, 10)

export interface DashboardUser {
  firstName: string | null
  lastInitial: string | null
  role: string
  isVerified: boolean
  avatarUrl: string | null
}

export interface BookingCard {
  id: string
  date: string
  startTime: string | null
  status: string
  otherName: string
  otherPic: string | null
  /** providers.id for a model's view, null for a stylist's. */
  providerId: string | null
  /**
   * The model's auth user id, for a stylist's view. Null for a model's.
   * Exactly one of this and providerId is set, and which one tells you whose
   * dashboard you are looking at.
   */
  modelUserId: string | null
  treatment: string | null
}

/** A stylist's ephemeral 48h status, shown to models already connected to them. */
export interface StylistUpdate {
  providerId: string
  name: string
  picUrl: string | null
  text: string
  expiresAt: string | null
}

export interface ModelDashboard {
  kind: 'model'
  upcoming: BookingCard[]
  pending: BookingCard[]
  /** Completed sessions with no review from this user yet. */
  awaitingReview: BookingCard[]
  completedCount: number
  favourites: { providerId: string; name: string; picUrl: string | null }[]
  updates: StylistUpdate[]
  hasActiveSubscription: boolean
}

export interface ProviderDashboard {
  kind: 'provider'
  providerId: string | null
  isPublished: boolean
  rating: number | null
  reviewCount: number
  isFoundingProvider: boolean
  applications: BookingCard[]
  upcoming: BookingCard[]
  /** Dates in the next 30 days with at least one untaken slot. */
  openDates: string[]
  portfolioCount: number
  /**
   * The stylist's most recent unexpired status post, whatever its state.
   *
   * NOT filtered to 'approved': a post held for review must be visible to its
   * author or the composer clears on submit and leaves them with no evidence
   * they wrote anything. 0031's RLS is what makes reading it possible; this is
   * where it reaches the screen.
   */
  statusPost: {
    id: string
    body: string
    expiresAt: string
    moderationStatus: 'pending' | 'approved' | 'rejected'
    reviewNote: string | null
    /**
     * Whether models can actually see this post — READ FROM 0033'S VIEW, not
     * worked out here.
     *
     * `moderation_status = 'approved'` is a moderation state and was being
     * reported to the stylist as "live". They are different things: an approved
     * post is invisible if the shop is unpublished, if it has expired, or if
     * the provider is a seed account. `public_stylist_status` is the authority
     * on all of that and the view can gain another clause tomorrow, so this
     * asks it rather than restating it in TypeScript — which is the two-places
     * problem that produced this bug in the first place.
     */
    isLive: boolean
  } | null
}

/** Who is looking, and which dashboard they get. */
export async function getDashboardUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardUser> {
  const { data } = await supabase
    .from('users')
    .select('first_name, last_initial, role, is_verified, profile_pic_url, is_founding_provider')
    .eq('id', userId)
    .maybeSingle()
  const u = (data ?? {}) as Record<string, unknown>
  return {
    // public.users, NOT auth user_metadata. Metadata is a snapshot frozen at
    // signup: accounts created before the payload existed have no first_name
    // at all, and a later name change never updates it. This is the column
    // ensureProfile keeps current and every other surface already reads.
    firstName: (u.first_name as string) ?? null,
    lastInitial: (u.last_initial as string) ?? null,
    role: (u.role as string) ?? 'model',
    isVerified: !!u.is_verified,
    avatarUrl: (u.profile_pic_url as string) ?? null,
  }
}

function toCards(
  rows: { id: string; provider_id: string; date: string; start_time?: string | null; status: string; treatment_id: string | null }[],
  provMap: Record<string, ProviderRef>,
  treatMap: Record<string, TreatmentRef>,
): BookingCard[] {
  return rows.map(r => ({
    id: r.id,
    date: r.date,
    startTime: r.start_time ?? null,
    status: r.status,
    otherName: provMap[r.provider_id]?.name ?? 'Stylist',
    otherPic: provMap[r.provider_id]?.profile_pic_url ?? null,
    providerId: r.provider_id,
    modelUserId: null,   // a model looking at their own dashboard; the counterparty is a stylist
    treatment: r.treatment_id ? (treatMap[r.treatment_id]?.name ?? treatMap[r.treatment_id]?.category ?? null) : null,
  }))
}

export async function getModelDashboard(
  supabase: SupabaseClient,
  userId: string,
): Promise<ModelDashboard> {
  const today = todayIso()

  const [upcomingRes, pendingRes, completedRes, favRes, subRes] = await Promise.all([
    supabase.from('sessions')
      .select('id, provider_id, date, start_time, status, treatment_id')
      .eq('model_user_id', userId).eq('status', 'accepted').gte('date', today)
      .order('date').order('start_time').limit(5),
    supabase.from('sessions')
      .select('id, provider_id, date, start_time, status, treatment_id')
      .eq('model_user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('sessions')
      .select('id, provider_id, date, start_time, status, treatment_id')
      .eq('model_user_id', userId).eq('status', 'completed')
      .order('date', { ascending: false }),
    supabase.from('favourites').select('provider_id').eq('user_id', userId),
    supabase.from('subscriptions').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle(),
  ])

  type SessRow = { id: string; provider_id: string; date: string; start_time: string | null; status: string; treatment_id: string | null }
  const upcoming  = (upcomingRes.data  ?? []) as SessRow[]
  const pending   = (pendingRes.data   ?? []) as SessRow[]
  const completed = (completedRes.data ?? []) as SessRow[]
  const favIds = ((favRes.data ?? []) as { provider_id: string }[]).map(f => f.provider_id)

  const providerIds = [...new Set([
    ...upcoming.map(s => s.provider_id),
    ...pending.map(s => s.provider_id),
    ...completed.map(s => s.provider_id),
    ...favIds,
  ])]
  const treatIds = [...new Set(
    [...upcoming, ...pending, ...completed].map(s => s.treatment_id).filter(Boolean) as string[],
  )]
  const completedIds = completed.map(s => s.id)

  const [provRes, statusRes, treatRes, myReviewsRes] = await Promise.all([
    providerIds.length > 0
      ? supabase.from('providers')
          .select('id, user_id, name, profile_pic_url')
          .in('id', providerIds)
      : Promise.resolve({ data: [], error: null }),
    // Statuses come from status_posts now, not providers.status_text (0031-0034).
    // Separate query rather than an embed because the filters differ: APPROVED
    // and unexpired, which the old column could not express — it had no
    // moderation state at all, so anything written was live immediately.
    //
    // Still only stylists this model already has a booking or a favourite with,
    // so nothing new is exposed. An aggregated cross-stylist feed is out of
    // bounds on the anon surface — web-phase-1-handover §6a, "a live map of who
    // is free where".
    providerIds.length > 0
      ? supabase.from('status_posts')
          .select('provider_id, body, expires_at')
          .in('provider_id', providerIds)
          .eq('moderation_status', 'approved')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    treatIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
      : Promise.resolve({ data: [], error: null }),
    completedIds.length > 0
      ? supabase.from('reviews').select('session_id').eq('reviewer_id', userId).in('session_id', completedIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const provMap  = indexById<ProviderRef>(provRes.data)
  const treatMap = indexById<TreatmentRef>(treatRes.data)
  const reviewed = new Set(((myReviewsRes.data ?? []) as { session_id: string }[]).map(r => r.session_id))

  // One update per stylist. The query is ordered newest-first, so the first row
  // seen for a provider wins — a stylist posting Thursday and then Friday means
  // the second supersedes, and two live updates from one shop would read as a
  // feed rather than a status. The composer enforces the same rule by clearing
  // the previous post; this is the reader-side half, so an old row surviving a
  // failed delete cannot produce a double entry.
  const seen = new Set<string>()
  const updates: StylistUpdate[] = ((statusRes.data ?? []) as {
    provider_id: string; body: string; expires_at: string
  }[])
    .filter(sp => {
      if (seen.has(sp.provider_id) || !provMap[sp.provider_id]) return false
      seen.add(sp.provider_id)
      return true
    })
    .map(sp => ({
      providerId: sp.provider_id,
      name: provMap[sp.provider_id]?.name ?? 'Stylist',
      picUrl: provMap[sp.provider_id]?.profile_pic_url ?? null,
      text: sp.body,
      expiresAt: sp.expires_at,
    }))

  return {
    kind: 'model',
    upcoming: toCards(upcoming, provMap, treatMap),
    pending:  toCards(pending,  provMap, treatMap),
    awaitingReview: toCards(completed.filter(s => !reviewed.has(s.id)).slice(0, 5), provMap, treatMap),
    completedCount: completed.length,
    favourites: favIds.map(id => ({
      providerId: id,
      name: provMap[id]?.name ?? 'Stylist',
      picUrl: provMap[id]?.profile_pic_url ?? null,
    })),
    updates,
    hasActiveSubscription: !!subRes.data,
  }
}

export async function getProviderDashboard(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProviderDashboard> {
  const today = todayIso()

  const { data: provRow } = await supabase
    .from('providers')
    .select('id, is_published, rating, review_count')
    .eq('user_id', userId)
    .maybeSingle()
  const prov = provRow as { id: string; is_published: boolean | null; rating: number | null; review_count: number | null } | null

  if (!prov) {
    return {
      kind: 'provider', providerId: null, isPublished: false, rating: null,
      reviewCount: 0, isFoundingProvider: false, applications: [], upcoming: [],
      statusPost: null,
      openDates: [], portfolioCount: 0,
    }
  }

  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  const [appsRes, upcomingRes, availRes, portRes, userRes, statusRes] = await Promise.all([
    supabase.from('sessions')
      .select('id, provider_id, model_user_id, date, start_time, status, treatment_id')
      .eq('provider_id', prov.id).eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase.from('sessions')
      .select('id, provider_id, model_user_id, date, start_time, status, treatment_id')
      .eq('provider_id', prov.id).eq('status', 'accepted').gte('date', today)
      .order('date').order('start_time').limit(10),
    supabase.from('availability')
      .select('date, is_taken').eq('provider_id', prov.id)
      .gte('date', today).lte('date', in30),
    supabase.from('portfolio_items').select('id', { count: 'exact', head: true }).eq('provider_id', prov.id),
    supabase.from('users').select('is_founding_provider').eq('id', userId).maybeSingle(),
    // The most recent unexpired status post, in ANY moderation state. Not
    // filtered to 'approved': a post held for review has to be visible to its
    // author, or the composer clears on submit and leaves them unable to tell a
    // held post from one that failed to save. 0031's RLS permits this read for
    // the owner only.
    supabase.from('status_posts')
      .select('id, body, expires_at, moderation_status, review_note')
      .eq('provider_id', prov.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  type SessRow = { id: string; provider_id: string; model_user_id: string; date: string; start_time: string | null; status: string; treatment_id: string | null }
  const apps     = (appsRes.data     ?? []) as SessRow[]
  const upcoming = (upcomingRes.data ?? []) as SessRow[]

  const modelIds = [...new Set([...apps, ...upcoming].map(s => s.model_user_id))]
  const treatIds = [...new Set([...apps, ...upcoming].map(s => s.treatment_id).filter(Boolean) as string[])]

  const [modelRes, treatRes] = await Promise.all([
    modelIds.length > 0
      ? supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').in('id', modelIds)
      : Promise.resolve({ data: [], error: null }),
    treatIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const modelMap = indexById<ProfileRef>(modelRes.data)
  const treatMap = indexById<TreatmentRef>(treatRes.data)

  const asCards = (rows: SessRow[]): BookingCard[] => rows.map(r => ({
    id: r.id,
    date: r.date,
    startTime: r.start_time,
    status: r.status,
    otherName: displayName(modelMap[r.model_user_id]),
    otherPic: modelMap[r.model_user_id]?.profile_pic_url ?? null,
    // Was `providerId: null` with "no profile route yet". There is one now
    // (/model/[id], 24 Aug 2026); the comment outlived the gap it described.
    providerId: null,
    modelUserId: r.model_user_id,
    treatment: r.treatment_id ? (treatMap[r.treatment_id]?.name ?? treatMap[r.treatment_id]?.category ?? null) : null,
  }))

  // ── IS THE POST ACTUALLY VISIBLE? ASK THE VIEW. ───────────────────────
  // One indexed lookup by primary key, and only when there is an approved post
  // to ask about. A row in public_stylist_status IS the definition of visible
  // (0033) — approved, unexpired, the shop published, and not a seed account.
  // That last clause is the reason not to reimplement this: nobody writing the
  // composer would have remembered it.
  //
  // A block is the one thing the view cannot express, because it is per-viewer
  // rather than a property of the post. That is why "live" is worded as "models
  // can see this" and not "everyone can".
  const sp = statusRes.data as {
    id: string; body: string; expires_at: string
    moderation_status: 'pending' | 'approved' | 'rejected'; review_note: string | null
  } | null

  let isLive = false
  if (sp && sp.moderation_status === 'approved') {
    const { data: liveRow, error: liveErr } = await supabase
      .from('public_stylist_status').select('id').eq('id', sp.id).maybeSingle()
    // Fail closed. If we cannot tell, do not claim it is live — that is the
    // exact false confirmation this read was added to remove.
    if (liveErr) console.error('[dashboard] status visibility check failed', liveErr)
    isLive = !liveErr && !!liveRow
  }

  const openDates = [...new Set(
    ((availRes.data ?? []) as { date: string; is_taken: boolean | null }[])
      .filter(a => !a.is_taken).map(a => a.date),
  )].sort()

  return {
    kind: 'provider',
    providerId: prov.id,
    isPublished: !!prov.is_published,
    rating: prov.rating,
    reviewCount: prov.review_count ?? 0,
    isFoundingProvider: !!(userRes.data as { is_founding_provider?: boolean } | null)?.is_founding_provider,
    applications: asCards(apps),
    upcoming: asCards(upcoming),
    openDates,
    portfolioCount: portRes.count ?? 0,
    statusPost: sp
      ? {
          id: sp.id,
          body: sp.body,
          expiresAt: sp.expires_at,
          moderationStatus: sp.moderation_status,
          reviewNote: sp.review_note,
          isLive,
        }
      : null,
  }
}

/* ── stylist updates, distance-filtered ────────────────────────────────── */

/** Miles. Same constant and formula as mobile/src/app/(app)/index.tsx:44. */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export interface UpdateFeed {
  updates: (StylistUpdate & { distanceMiles: number | null })[]
  /** Null when the account has no stored location, which disables filtering. */
  viewerHasLocation: boolean
  /**
   * True when at least one live update was withheld because of a block — audit
   * item 20.
   *
   * An empty feed used to say "no stylists have posted an update right now",
   * which is a claim about the world. Three things make it false: a block, an
   * unpublished shop, and the distance filter. The block is the only one the
   * reader can act on, so it is the only one named.
   *
   * DELIBERATELY A BOOLEAN, NOT A COUNT. A count of one tells a model who
   * blocked exactly one stylist that that stylist posted today, which is more
   * than they need and more than we should say.
   */
  hiddenByBlock: boolean
}

/**
 * Every live stylist update within `radiusMiles`, not just from stylists the
 * model already knows.
 *
 * ── WHY THIS IS ALLOWED, AND WHERE THE LINE IS ────────────────────────────
 * web-phase-1-handover §6a forbids an aggregated, cross-stylist,
 * location-filtered feed on the ANON surface — "a live map of who is free
 * where". The sentence immediately after it describes this feed: the model-side
 * one "is authenticated and distance-filtered and stays that way".
 *
 * So the constraint is the audience, not the shape. This runs behind the auth
 * gate, through RLS, for a signed-in member. Nothing here may ever be reachable
 * from (public) — which is what the client-boundary check enforces.
 *
 * Restricted to PUBLISHED stylists: an unpublished shop is not visible in the
 * app either, and a status update is not a way around that.
 */
export async function getStylistUpdates(
  supabase: SupabaseClient,
  userId: string,
  radiusMiles: number | null,
): Promise<UpdateFeed> {
  const [meRes, provRes, statusRes, blockRes] = await Promise.all([
    supabase.from('users').select('latitude, longitude').eq('id', userId).maybeSingle(),
    supabase.from('providers')
      .select('id, user_id, name, profile_pic_url, latitude, longitude, location_lat, location_lng')
      .eq('is_published', true),
    // status_posts, not providers.status_text (0031-0034). APPROVED and
    // unexpired — the old column had no moderation state, so anything written
    // was live the instant it was written.
    supabase.from('status_posts')
      .select('provider_id, body, expires_at')
      .eq('moderation_status', 'approved')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
    supabase.from('blocks').select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
  ])

  const me = meRes.data as { latitude: number | null; longitude: number | null } | null
  const hasLoc = me?.latitude != null && me?.longitude != null

  let hiddenByBlock = false
  let hiddenByBlock = false
  const blocked = new Set(
    ((blockRes.data ?? []) as { blocker_id: string; blocked_id: string }[])
      .map(b => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)),
  )

  const rows = (provRes.data ?? []) as {
    id: string; user_id: string | null; name: string | null; profile_pic_url: string | null
    latitude: number | null; longitude: number | null
    location_lat: number | null; location_lng: number | null
  }[]
  const provById = Object.fromEntries(rows.map(r => [r.id, r]))

  // Newest post per stylist. Expiry and moderation are already filtered in the
  // query, so nothing here re-checks them — the old code had to, because the
  // column carried expired text indefinitely.
  const seen = new Set<string>()
  const updates = ((statusRes.data ?? []) as {
    provider_id: string; body: string; expires_at: string
  }[])
    .filter(sp => {
      if (seen.has(sp.provider_id)) return false
      seen.add(sp.provider_id)
      return true
    })
    .map(sp => ({ sp, p: provById[sp.provider_id] }))
    // A post whose stylist is not in rows is one whose shop is unpublished, and
    // an unpublished shop is invisible in the app — a status update must not be
    // a way around that.
    .filter(({ p }) => !!p)
    .filter(({ p }) => {
      if (p.user_id && blocked.has(p.user_id)) { hiddenByBlock = true; return false }
      return true
    })
    .map(({ sp, p }) => {
      // providers carries lat/lng twice, the same duplication as
      // location/location_text. Prefer whichever is populated rather than
      // picking one and showing nothing for half the rows.
      const lat = p.latitude ?? p.location_lat
      const lng = p.longitude ?? p.location_lng
      const distanceMiles =
        hasLoc && lat != null && lng != null
          ? haversineMiles(me!.latitude!, me!.longitude!, lat, lng)
          : null
      return {
        providerId: p.id,
        name: p.name ?? 'Stylist',
        picUrl: p.profile_pic_url,
        text: sp.body,
        expiresAt: sp.expires_at,
        distanceMiles,
      }
    })
    // A stylist with no coordinates is kept when no radius is set and dropped
    // when one is — being unable to prove they are near is not proof they are.
    .filter(u => radiusMiles == null || (u.distanceMiles != null && u.distanceMiles <= radiusMiles))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))

  return { updates, viewerHasLocation: !!hasLoc, hiddenByBlock }
}
