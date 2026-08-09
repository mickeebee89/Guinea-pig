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

  const [provRes, treatRes, myReviewsRes] = await Promise.all([
    providerIds.length > 0
      // status_text is fetched here rather than in a separate feed query: these
      // are stylists this model already has a booking or a favourite with, so
      // nothing new is exposed. An aggregated cross-stylist feed is explicitly
      // out of bounds — see web-phase-1-handover §6a, "a live map of who is
      // free where".
      ? supabase.from('providers')
          .select('id, user_id, name, profile_pic_url, status_text, status_expires_at')
          .in('id', providerIds)
      : Promise.resolve({ data: [], error: null }),
    treatIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
      : Promise.resolve({ data: [], error: null }),
    completedIds.length > 0
      ? supabase.from('reviews').select('session_id').eq('reviewer_id', userId).in('session_id', completedIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  type ProvRow = ProviderRef & { status_text: string | null; status_expires_at: string | null }
  const provMap  = indexById<ProvRow>(provRes.data)
  const treatMap = indexById<TreatmentRef>(treatRes.data)
  const reviewed = new Set(((myReviewsRes.data ?? []) as { session_id: string }[]).map(r => r.session_id))

  const now = Date.now()
  const updates: StylistUpdate[] = Object.values(provMap)
    .filter(p => p.status_text && (!p.status_expires_at || new Date(p.status_expires_at).getTime() > now))
    .map(p => ({
      providerId: p.id,
      name: p.name ?? 'Stylist',
      picUrl: p.profile_pic_url,
      text: p.status_text as string,
      expiresAt: p.status_expires_at,
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
      openDates: [], portfolioCount: 0,
    }
  }

  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  const [appsRes, upcomingRes, availRes, portRes, userRes] = await Promise.all([
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
    providerId: null,     // a stylist's counterparty is a model; no profile route yet
    treatment: r.treatment_id ? (treatMap[r.treatment_id]?.name ?? treatMap[r.treatment_id]?.category ?? null) : null,
  }))

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
  }
}
