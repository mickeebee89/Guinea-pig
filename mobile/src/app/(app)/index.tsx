import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
  Platform,
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { Colors, CategoryColors, Fonts, Radius } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { isIdentityVerified } from '@/lib/verification'
import { getBlockedIds } from '@/lib/blocks'
import ScreenDecor from '@/components/ScreenDecor'
import CancelSheet from '@/components/CancelSheet'
import { isShortNotice } from '@/lib/cancel'
import HeaderIcons from '@/components/HeaderIcons'
import { useAppRole } from '@/components/AppEntry'
import LoadErrorState from '@/components/LoadErrorState'
import ProviderDashboardScreen from './provider-dashboard'

const CATEGORIES = [
  { name: 'All',       color: Colors.muted        },
  { name: 'Nails',     color: CategoryColors.nails },
  { name: 'Lashes',    color: CategoryColors.lashes },
  { name: 'Brows',     color: CategoryColors.brows },
  { name: 'Hair',      color: CategoryColors.hair  },
  { name: 'Makeup',    color: CategoryColors.makeup },
  { name: 'Spray Tan', color: CategoryColors.sprayTan },
] as const

const DISTANCE_OPTIONS = ['Any', '1 mi', '2 mi', '4 mi', '10 mi', '20 mi'] as const
type DistanceOption = typeof DISTANCE_OPTIONS[number]

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(d: number): string {
  if (d < 0.1) return 'nearby'
  if (d < 10) return `${d.toFixed(1)} mi`
  return `${Math.round(d)} mi`
}

const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(
  CATEGORIES.filter(c => c.name !== 'All').map(c => [c.name, c.color])
)

type ProviderTreatment = { category: string }

type Provider = {
  id: string
  name: string
  location: string | null
  is_verified: boolean
  rating: number | null
  profile_pic_url: string | null
  provider_treatments: ProviderTreatment[]
  latitude: number | null
  longitude: number | null
  distance: number | null
}

type UpcomingSession = {
  id: string
  provider_id: string
  provider_name: string
  provider_pic: string | null
  date: string
  start_time: string
  treatment_name: string | null
  treatment_category: string | null
  location_type: string | null
}

type PendingApp = {
  id: string
  provider_id: string
  provider_name: string
  provider_pic: string | null
  date: string
  start_time: string
  treatment_name: string | null
  treatment_category: string | null
}

type Invite = {
  id: string
  title: string
  body: string
  data: { provider_id?: string; shop_handle?: string }
  created_at: string
}

/** A stylist's live 48-hour update, as it appears in the model's feed. */
type StylistUpdate = {
  providerId: string
  name:       string
  picUrl:     string | null
  body:       string
}

type SubscriptionInfo = { status: string; periodEnd: string | null }
type ImpactInfo      = { completed: number; distinctProviders: number }

type ReviewItem = {
  id: string
  // providers.id — needed to open the shop from the avatar. It was in scope in
  // the mapper but dropped.
  provider_id: string
  provider_name: string
  provider_pic: string | null
  date: string
  treatment_name: string | null
  treatment_category: string | null
}

function formatSessDate(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const [h, min] = timeStr.split(':').map(Number)
  return `${label} · ${h % 12 || 12}:${String(min).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
}

function formatPeriodEnd(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Role is fetched once in RoleRouter (components/RoleRouter.tsx) and provided
// via context. This screen reads it and renders the appropriate content directly
// — no navigation calls, no Redirect.
export default function AppHome() {
  const role = useAppRole()
  if (role === 'provider') return <ProviderDashboardScreen />
  return <ModelHomeContent />
}

function ModelHomeContent() {
  const router = useRouter()
  const { session } = useAuth()
  const userId = session?.user?.id

  const [providers, setProviders]               = useState<Provider[]>([])
  const [updates,   setUpdates]                 = useState<StylistUpdate[]>([])
  const [allUpdates, setAllUpdates]             = useState(false)
  /** At least one live update withheld by a block — audit item 20. */
  const [updatesBlocked, setUpdatesBlocked]     = useState(false)
  const [favouriteIds, setFavouriteIds]         = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [search, setSearch]                     = useState('')
  const [distanceFilter, setDistanceFilter]     = useState<DistanceOption>('Any')
  const [verifiedOnly, setVerifiedOnly]         = useState(false)
  const [showFilters, setShowFilters]           = useState(false)
  const [userLat, setUserLat]                   = useState<number | null>(null)
  const [userLng, setUserLng]                   = useState<number | null>(null)
  const [refreshing, setRefreshing]             = useState(false)
  const [loading, setLoading]                   = useState(true)
  const [loadError, setLoadError]               = useState(false)
  const [profilePicUrl, setProfilePicUrl]       = useState<string | null>(null)
  const [upcomingSessions, setUpcomingSessions] = useState<UpcomingSession[]>([])
  const [pendingApps,      setPendingApps]      = useState<PendingApp[]>([])
  const [invites,          setInvites]          = useState<Invite[]>([])
  const [subscription,     setSubscription]     = useState<SubscriptionInfo | null>(null)
  const [isVerified,       setIsVerified]       = useState(false)
  const [impact,           setImpact]           = useState<ImpactInfo | null>(null)
  const [toReview,         setToReview]         = useState<ReviewItem[]>([])

  // ── CANCELLING, FROM THE MODEL'S SIDE ────────────────────────────────────
  // This screen is where a model sees their own bookings — sessions.tsx is
  // provider-only and bails without a providers row. Chat covers both parties
  // only once a chat EXISTS, and a chat opens on confirmation, so a model who
  // wants out of a PENDING application had no route at all. Items 9 and 10
  // again: the mechanism was there and nothing reached it.
  const [cancelTarget, setCancelTarget] =
    useState<{ id: string; name: string; shortNotice: boolean } | null>(null)

  const fetchData = useCallback(async () => {
    if (!userId) { setLoading(false); return }

    setLoadError(false)
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('profile_pic_url, latitude, longitude')
        .eq('id', userId)
        .single()

      setProfilePicUrl((userData as any)?.profile_pic_url ?? null)
      // Use stored GPS immediately so distance shows without waiting for device GPS
      if ((userData as any)?.latitude != null && (userData as any)?.longitude != null) {
        setUserLat((userData as any).latitude)
        setUserLng((userData as any).longitude)
      }

      // GPS — request and store in background, don't block provider load
      Location.requestForegroundPermissionsAsync().then(({ status }) => {
        if (status === 'granted') {
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(loc => {
            setUserLat(loc.coords.latitude)
            setUserLng(loc.coords.longitude)
            supabase.from('users').update({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            }).eq('id', userId).then(() => {})
          }).catch(() => {})
        }
      }).catch(() => {})

      const [{ data: provData }, { data: favData }, blockedIds, { data: statusData }] = await Promise.all([
        supabase
          .from('providers')
          .select('id, user_id, name, profile_pic_url, is_verified, rating, location_text, latitude, longitude, provider_treatments(category)')
          .eq('is_published', true),
        supabase
          .from('favourites')
          .select('provider_id')
          .eq('user_id', userId),
        getBlockedIds(userId).catch(() => new Set<string>()),
        // APPROVED and unexpired only. Same filters as the web feed
        // (site/lib/queries/dashboard.ts) — the moderation state and the expiry
        // are the database's business, not this screen's.
        supabase
          .from('status_posts')
          .select('provider_id, body, created_at')
          .eq('moderation_status', 'approved')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ])

      // Mutual block: hide any stylist whose owning user is blocked either
      // direction. Held in a local so the update feed can join against exactly
      // the same set — see below for why that matters.
      const visibleProviders = (provData as any[] ?? [])
        .filter(p => !blockedIds.has(p.user_id as string))

      if (provData) {
        setProviders(visibleProviders
          .map(p => ({
          id:                  p.id,
          name:                (p.name as string) || 'Stylist',
          location:            (p.location_text as string | null) || null,
          is_verified:         !!(p.is_verified),
          rating:              (p.rating as number | null) ?? null,
          profile_pic_url:     (p.profile_pic_url as string | null) ?? null,
          provider_treatments: Array.isArray(p.provider_treatments) ? p.provider_treatments : [],
          latitude:            (p.latitude as number | null) ?? null,
          longitude:           (p.longitude as number | null) ?? null,
          distance:            null,
        })))
      }

      // ── THE FEED JOINS AGAINST THE VISIBLE PROVIDER SET, NOT status_posts ──
      //
      // A post whose stylist is not in that set is dropped, and the two reasons
      // that happens are both deliberate: the shop is unpublished (an
      // unpublished shop is invisible, and an update must not be a way round
      // that) or the pair is blocked. It is the same rule the web feed applies
      // and the same one that made a post look missing on 7 Sep when a test
      // block was still in place — audit item 20.
      //
      // ONE UPDATE PER STYLIST. The query is newest-first, so the first row seen
      // for a provider wins. Two live posts from one shop would read as a feed
      // rather than as a status, and the composer enforces the same rule by
      // clearing the previous post; this is the reader-side half.
      const provById: Record<string, any> = {}
      for (const p of visibleProviders) provById[p.id as string] = p

      // Blocked stylists are removed from visibleProviders above, so their
      // posts would simply vanish. Note that it happened, without recording who
      // — audit item 20 wants the reason named, not the person.
      const blockedProviderIds = new Set(
        (provData as any[] ?? [])
          .filter(p => blockedIds.has(p.user_id as string))
          .map(p => p.id as string),
      )
      setUpdatesBlocked(((statusData as any[]) ?? [])
        .some(sp => blockedProviderIds.has(sp.provider_id as string)))
      const seen = new Set<string>()
      setUpdates(((statusData as any[]) ?? [])
        .filter(sp => {
          const pid = sp.provider_id as string
          if (seen.has(pid) || !provById[pid]) return false
          seen.add(pid)
          return true
        })
        .map(sp => ({
          providerId: sp.provider_id as string,
          name:       (provById[sp.provider_id]?.name as string) || 'Stylist',
          picUrl:     (provById[sp.provider_id]?.profile_pic_url as string | null) ?? null,
          body:       sp.body as string,
        })))

      if (favData) {
        setFavouriteIds(new Set((favData as { provider_id: string }[]).map(f => f.provider_id)))
      }

      // ── Dashboard data ────────────────────────────────────────────────────
      const todayStr = (() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()

      const [
        { data: upcomingRaw },
        { data: pendingRaw },
        { data: inviteRaw },
        { data: subRaw },
        { data: completedRaw },
        verifiedResult,
      ] = await Promise.all([
        supabase.from('sessions').select('id, provider_id, date, start_time, treatment_id, location_type').eq('model_user_id', userId).eq('status', 'accepted').gte('date', todayStr).order('date').order('start_time').limit(5),
        supabase.from('sessions').select('id, provider_id, date, start_time, treatment_id').eq('model_user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
        supabase.from('notifications').select('id, title, body, data, created_at').eq('user_id', userId).eq('type', 'stylist_invite').is('read_at', null).order('created_at', { ascending: false }).limit(10),
        supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle(),
        supabase.from('sessions').select('id, provider_id, date, treatment_id').eq('model_user_id', userId).eq('status', 'completed').order('date', { ascending: false }),
        isIdentityVerified(userId).catch(() => false),
      ])

      const completedSessions = (completedRaw ?? []) as any[]
      const completedIds = completedSessions.map(s => s.id as string)

      const allProviderIds = [...new Set([...(upcomingRaw ?? []).map((s: any) => s.provider_id), ...(pendingRaw ?? []).map((s: any) => s.provider_id), ...completedSessions.map(s => s.provider_id as string)])]
      const allTreatmentIds = [...new Set([...(upcomingRaw ?? []).map((s: any) => s.treatment_id), ...(pendingRaw ?? []).map((s: any) => s.treatment_id), ...completedSessions.map(s => s.treatment_id)].filter(Boolean) as string[])]

      const [{ data: sessProviders }, { data: sessTreats }, { data: myReviews }] = await Promise.all([
        allProviderIds.length > 0 ? supabase.from('providers').select('id, name, profile_pic_url').in('id', allProviderIds) : Promise.resolve({ data: [] as any[] }),
        allTreatmentIds.length > 0 ? supabase.from('provider_treatments').select('id, name, category').in('id', allTreatmentIds) : Promise.resolve({ data: [] as any[] }),
        completedIds.length > 0 ? supabase.from('reviews').select('session_id').eq('reviewer_id', userId).in('session_id', completedIds) : Promise.resolve({ data: [] as any[] }),
      ])
      const reviewedSet = new Set((myReviews ?? []).map((r: any) => r.session_id as string))

      const provMap: Record<string, { name: string; pic: string | null }> = Object.fromEntries(
        (sessProviders ?? []).map((p: any) => [p.id, { name: p.name as string, pic: (p.profile_pic_url as string | null) ?? null }])
      )
      const treatMap: Record<string, { name: string; category: string }> = Object.fromEntries(
        (sessTreats ?? []).map((t: any) => [t.id, { name: t.name as string, category: t.category as string }])
      )

      setUpcomingSessions((upcomingRaw ?? []).map((s: any) => ({
        id:                 s.id,
        provider_id:        s.provider_id,
        provider_name:      provMap[s.provider_id]?.name ?? 'Stylist',
        provider_pic:       provMap[s.provider_id]?.pic ?? null,
        date:               s.date,
        start_time:         s.start_time,
        treatment_name:     s.treatment_id ? (treatMap[s.treatment_id]?.name ?? null) : null,
        treatment_category: s.treatment_id ? (treatMap[s.treatment_id]?.category ?? null) : null,
        location_type:      s.location_type ?? null,
      })))

      setPendingApps((pendingRaw ?? []).map((s: any) => ({
        id:                 s.id,
        provider_id:        s.provider_id,
        provider_name:      provMap[s.provider_id]?.name ?? 'Stylist',
        provider_pic:       provMap[s.provider_id]?.pic ?? null,
        date:               s.date,
        start_time:         s.start_time,
        treatment_name:     s.treatment_id ? (treatMap[s.treatment_id]?.name ?? null) : null,
        treatment_category: s.treatment_id ? (treatMap[s.treatment_id]?.category ?? null) : null,
      })))

      setInvites((inviteRaw ?? []).map((n: any) => ({
        id:         n.id,
        title:      n.title as string,
        body:       n.body as string,
        data:       (n.data ?? {}) as Invite['data'],
        created_at: n.created_at as string,
      })))

      const periodEnd = (subRaw as any)?.current_period_end ?? (subRaw as any)?.period_end ?? (subRaw as any)?.expires_at ?? null
      setSubscription(subRaw ? { status: (subRaw as any).status as string, periodEnd: periodEnd ? String(periodEnd) : null } : null)
      setIsVerified(verifiedResult as boolean)

      setToReview(completedSessions
        .filter(s => !reviewedSet.has(s.id as string))
        .map(s => ({
          id:                 s.id as string,
          provider_id:        s.provider_id as string,
          provider_name:      provMap[s.provider_id]?.name ?? 'Stylist',
          provider_pic:       provMap[s.provider_id]?.pic ?? null,
          date:               s.date as string,
          treatment_name:     s.treatment_id ? (treatMap[s.treatment_id]?.name ?? null) : null,
          treatment_category: s.treatment_id ? (treatMap[s.treatment_id]?.category ?? null) : null,
        })))

      const completedList = completedRaw ?? []
      setImpact({
        completed:         completedList.length,
        distinctProviders: new Set(completedList.map((s: any) => s.provider_id as string)).size,
      })
    } catch (e) {
      console.error('index load failed:', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Refresh on focus (not just mount) so lists like "to review" update after
  // actions such as leaving a review. fetchData never sets loading=true, so no flash.
  useFocusEffect(useCallback(() => { fetchData() }, [fetchData]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  const openProvider = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/provider/[id]', params: { id } })
  }

  // Enrich providers with distance when we have GPS
  const providersWithDist = providers.map(p => ({
    ...p,
    distance: (userLat != null && userLng != null && p.latitude != null && p.longitude != null)
      ? haversine(userLat, userLng, p.latitude, p.longitude)
      : null,
  }))

  const hasActiveFilter = selectedCategory !== 'All' || distanceFilter !== 'Any' || verifiedOnly

  // Distance is only meaningful once we know where the user is.
  const knowsLocation = userLat != null && userLng != null
  const distanceMiles = distanceFilter === 'Any' || !knowsLocation ? null : parseInt(distanceFilter)

  const filtered = providersWithDist
    .filter(p => {
      const matchesCategory =
        selectedCategory === 'All' ||
        p.provider_treatments.some(t => t.category === selectedCategory)
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q)
      // No `p.distance == null` escape hatch: that made a chosen radius match
      // EVERY provider whenever we had no location, so the chip lit up and
      // filtered nothing. If we can't place a stylist, a radius can't include
      // them. The chips are disabled outright when location is unknown, so this
      // only bites for a stylist who hasn't set their own coordinates.
      const matchesDistance =
        distanceMiles == null || (p.distance != null && p.distance <= distanceMiles)
      const matchesVerified = !verifiedOnly || p.is_verified
      return matchesCategory && matchesSearch && matchesDistance && matchesVerified
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))

  // Show exactly what the filters matched. (This used to silently fall back to the FULL
  // list when nothing matched, which made search look broken — the chips stayed lit and
  // the results contradicted them. A real "no matches" state is rendered below instead.)
  const displayProviders = filtered

  const favouriteProviders = providersWithDist.filter(p => favouriteIds.has(p.id))

  return (
    <View style={styles.container}>
      <ScreenDecor />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.rose}
              colors={[Colors.rose]}
            />
          }
        >
          {/* ── Title ── */}
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>Dashboard</Text>
            <View style={styles.titleIcons}>
              <HeaderIcons />
              <TouchableOpacity
                style={styles.profileBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  router.push('/(app)/model-profile' as any)
                }}
                activeOpacity={0.85}
              >
                {profilePicUrl ? (
                  <Image source={{ uri: profilePicUrl }} style={styles.profileBtnImg} />
                ) : (
                  <View style={styles.profileBtnPlaceholder}>
                    <Ionicons name="person" size={18} color={Colors.roseDark} />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Stylist updates ──
              TOP OF THE PAGE, and capped at five. These are perishable — 48
              hours — so they are worth seeing first, but an uncapped feed on a
              busy week would push a model's own bookings off the screen. Five
              fit without scrolling; the rest are one tap away.

              It renders even when empty, and the empty text says WHICH empty —
              see the note below. It was hidden when empty for about an hour on
              8 Sep, which was wrong for the reason recorded in audit item 20. */}
          <Section title="Stylist updates" boxed>
            {updates.length === 0 ? (
              /* ── AN EMPTY FEED STILL HAS TO SAY WHICH EMPTY IT IS ──────────
                 This section was hidden entirely when empty, which made audit
                 item 20 worse rather than neutral: a model who had blocked the
                 stylists posting nearby saw no section at all, which reads as a
                 feature that does not exist rather than a feed that is
                 filtered. Web words its empty state; so does this now. */
              <Text style={styles.updatesEmpty}>
                {updatesBlocked
                  ? 'Nothing to show right now. You\u2019ve blocked one or more stylists, so their updates don\u2019t appear here.'
                  : 'No stylist has posted an update right now. Updates last 48 hours, so this changes through the week.'}
              </Text>
            ) : null}
            {(allUpdates ? updates : updates.slice(0, 5)).map(u => (
                <UpdateRow key={u.providerId} update={u} onOpen={() => openProvider(u.providerId)} />
              ))}
            {updates.length > 5 && (
              <TouchableOpacity
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setAllUpdates(v => !v)
                }}
                style={styles.updatesMoreBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.updatesMoreText}>
                  {allUpdates ? 'Show fewer' : `Show all ${updates.length}`}
                </Text>
              </TouchableOpacity>
            )}
          </Section>

          {/* ── Upcoming sessions ── */}
          {upcomingSessions.length > 0 && (
            <Section title={`Upcoming treatments (${upcomingSessions.length})`}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.upcomingScroll}
              >
                {upcomingSessions.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.upcomingCard}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId: s.id } })
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.upcomingHeader}>
                      {/* Avatar opens the stylist's shop; the rest of the card
                         keeps its own action (chat / leave a review). */}
                      <TouchableOpacity
                        style={styles.dashAvatarWrap}
                        onPress={() => openProvider(s.provider_id)}
                        activeOpacity={0.8}
                      >
                        {s.provider_pic ? (
                          <Image source={{ uri: s.provider_pic }} style={styles.dashAvatar} />
                        ) : (
                          <View style={[styles.dashAvatarPlaceholder, { backgroundColor: Colors.softPink }]}>
                            <Text style={styles.dashAvatarInitial}>{s.provider_name[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dashTitle} numberOfLines={1}>{s.provider_name}</Text>
                        <Text style={styles.dashMeta} numberOfLines={1}>{formatSessDate(s.date, s.start_time)}</Text>
                      </View>
                    </View>
                    {s.treatment_name ? (
                      <Text style={[styles.dashTag, { color: CATEGORY_COLOR[s.treatment_category ?? ''] ?? Colors.roseDark }]}>
                        {s.treatment_name}
                      </Text>
                    ) : null}
                    <View style={[styles.dashStatusBadge, styles.upcomingStatus]}>
                      <Text style={styles.dashStatusText}>Confirmed</Text>
                    </View>
                    {/* Visible on the card, not behind a menu. See
                        docs/safety-surface.md — the person cancelling under
                        pressure is often the one who would otherwise be
                        reaching for Safety. */}
                    <TouchableOpacity
                      style={styles.cardCancel}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setCancelTarget({
                          id: s.id,
                          name: s.provider_name,
                          shortNotice: isShortNotice(s.date),
                        })
                      }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel your booking with ${s.provider_name}`}
                    >
                      <Text style={styles.cardCancelText}>Cancel booking</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Section>
          )}

          {/* ── Needs your attention ── */}
          {(pendingApps.length > 0 || invites.length > 0 || toReview.length > 0) && (
            <Section title="Needs your attention">

              {toReview.length > 0 && (
                <>
                  <Text style={styles.attentionLabel}>Treatments to review</Text>
                  {toReview.map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.dashCard}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId: s.id, revieweeType: 'provider' } })
                      }}
                      activeOpacity={0.85}
                    >
                      {/* Avatar opens the stylist's shop; the rest of the card
                         keeps its own action (chat / leave a review). */}
                      <TouchableOpacity
                        style={styles.dashAvatarWrap}
                        onPress={() => openProvider(s.provider_id)}
                        activeOpacity={0.8}
                      >
                        {s.provider_pic ? (
                          <Image source={{ uri: s.provider_pic }} style={styles.dashAvatar} />
                        ) : (
                          <View style={[styles.dashAvatarPlaceholder, { backgroundColor: Colors.softPink }]}>
                            <Text style={styles.dashAvatarInitial}>{s.provider_name[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <View style={styles.dashInfo}>
                        <Text style={styles.dashTitle}>{s.provider_name}</Text>
                        <Text style={styles.dashMeta}>{s.treatment_name ? `${s.treatment_name} · ` : ''}How was it?</Text>
                      </View>
                      <View style={styles.reviewPill}>
                        <Ionicons name="star" size={12} color={Colors.white} />
                        <Text style={styles.reviewPillText}>Review</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {pendingApps.length > 0 && (
                <>
                  <Text style={[styles.attentionLabel, toReview.length > 0 && { marginTop: 12 }]}>Pending applications</Text>
                  {pendingApps.map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.dashCard}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId: s.id } })
                      }}
                      activeOpacity={0.85}
                    >
                      {/* Avatar opens the stylist's shop; the rest of the card
                         keeps its own action (chat / leave a review). */}
                      <TouchableOpacity
                        style={styles.dashAvatarWrap}
                        onPress={() => openProvider(s.provider_id)}
                        activeOpacity={0.8}
                      >
                        {s.provider_pic ? (
                          <Image source={{ uri: s.provider_pic }} style={styles.dashAvatar} />
                        ) : (
                          <View style={[styles.dashAvatarPlaceholder, { backgroundColor: Colors.softPink }]}>
                            <Text style={styles.dashAvatarInitial}>{s.provider_name[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <View style={styles.dashInfo}>
                        <Text style={styles.dashTitle}>{s.provider_name}</Text>
                        <Text style={styles.dashMeta}>{formatSessDate(s.date, s.start_time)}</Text>
                        {s.treatment_name ? (
                          <Text style={[styles.dashTag, { color: CATEGORY_COLOR[s.treatment_category ?? ''] ?? Colors.roseDark }]}>
                            {s.treatment_name}
                          </Text>
                        ) : null}
                      </View>
                      <View style={[styles.dashStatusBadge, styles.dashStatusPending]}>
                        <Text style={[styles.dashStatusText, styles.dashStatusTextPending]}>Awaiting reply</Text>
                      </View>
                      {/* THE ROUTE THAT DID NOT EXIST. A pending application has
                          no readable chat — chat opens on confirmation — so
                          until now a model who changed their mind before a
                          stylist replied had nowhere to go. */}
                      <TouchableOpacity
                        style={styles.cardCancel}
                        onPress={async () => {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          setCancelTarget({
                            id: s.id,
                            name: s.provider_name,
                            shortNotice: isShortNotice(s.date),
                          })
                        }}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel your application to ${s.provider_name}`}
                      >
                        <Text style={styles.cardCancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {invites.length > 0 && (
                <>
                  <Text style={[styles.attentionLabel, (pendingApps.length > 0 || toReview.length > 0) && { marginTop: 12 }]}>
                    Invites from stylists
                  </Text>
                  {invites.map(n => {
                    const provId = n.data?.provider_id
                    return (
                      <TouchableOpacity
                        key={n.id}
                        style={styles.dashCard}
                        onPress={async () => {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          if (provId) router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: provId } })
                          else router.push('/(app)/notifications' as any)
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={[styles.dashAvatarWrap, { backgroundColor: Colors.roseDark + '18' }]}>
                          <Ionicons name="mail-outline" size={22} color={Colors.roseDark} />
                        </View>
                        <View style={styles.dashInfo}>
                          <Text style={styles.dashTitle}>{n.title}</Text>
                          <Text style={styles.dashMeta} numberOfLines={2}>{n.body}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                      </TouchableOpacity>
                    )
                  })}
                </>
              )}
            </Section>
          )}

          {/* ── Favourites ── */}
          <Section title="Favourites">
            {favouriteProviders.length === 0 ? (
              <View style={styles.emptyFavs}>
                <Text style={styles.emptyFavsEmoji}>🤍</Text>
                <Text style={styles.emptyFavsText}>
                  Save stylists you love — tap the heart on any profile
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.favsRow}
              >
                {favouriteProviders.map(p => (
                  <FavouriteCard key={p.id} provider={p} onPress={() => openProvider(p.id)} />
                ))}
              </ScrollView>
            )}
          </Section>

          {/* ── Nearby stylists ── */}
          {/* "Nearby" only when we can actually measure it. Someone browsing
             from abroad, or with location off, is shown the whole list — so
             promising proximity would be a plain untruth. */}
          <Section
            title={knowsLocation ? 'Nearby stylists' : 'Stylists'}
            right={
              /* The Filter pill sits in the header row but OUTSIDE the collapse
                 toggle: a control there must not be swallowed by the tap that
                 opens and closes the section. */
              <TouchableOpacity
                style={[styles.filterBtn, (showFilters || hasActiveFilter) && styles.filterBtnActive]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setShowFilters(f => !f)
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="options-outline" size={14} color={(showFilters || hasActiveFilter) ? Colors.white : Colors.roseDark} />
                <Text style={[styles.filterBtnText, (showFilters || hasActiveFilter) && { color: Colors.white }]}>Filter</Text>
              </TouchableOpacity>
            }
          >

            {/* Search bar below */}
            <View style={styles.nearbySearchBar}>
              <Ionicons name="search-outline" size={15} color={Colors.muted} />
              <TextInput
                style={styles.nearbySearchInput}
                placeholder="Search stylists…"
                placeholderTextColor={Colors.muted}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Ionicons name="close-circle" size={15} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Filter panel */}
            {showFilters && (
              <View style={styles.filterPanel}>
                <Text style={styles.filterPanelLabel}>Treatment</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
                  {CATEGORIES.map(cat => {
                    const active = selectedCategory === cat.name
                    return (
                      <TouchableOpacity
                        key={cat.name}
                        style={[
                          styles.distChip,
                          active
                            ? { backgroundColor: cat.color, borderColor: cat.color }
                            : { borderColor: cat.color },
                        ]}
                        onPress={async () => {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          setSelectedCategory(cat.name)
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.distChipText, active ? styles.distChipTextActive : { color: cat.color }]}>
                          {cat.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
                <Text style={styles.filterPanelLabel}>Distance</Text>
                {/* Disabled without location rather than left tappable — a radius we
                   can't apply is a control that lies about what it did. */}
                {!knowsLocation && (
                  <Text style={styles.filterPanelNote}>
                    Turn on location to filter by distance. Showing all stylists.
                  </Text>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
                  {DISTANCE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={[
                        styles.distChip,
                        distanceFilter === opt && styles.distChipActive,
                        !knowsLocation && opt !== 'Any' && styles.distChipDisabled,
                      ]}
                      disabled={!knowsLocation && opt !== 'Any'}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setDistanceFilter(opt)
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.distChipText, distanceFilter === opt && styles.distChipTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.verifiedToggleRow}>
                  <Text style={styles.verifiedToggleLabel}>Verified only</Text>
                  <Switch
                    value={verifiedOnly}
                    onValueChange={async v => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setVerifiedOnly(v)
                    }}
                    trackColor={{ false: Colors.border, true: Colors.rose }}
                    thumbColor={verifiedOnly ? Colors.roseDark : Colors.muted}
                    ios_backgroundColor={Colors.border}
                  />
                </View>
              </View>
            )}
            {loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Finding stylists…</Text>
              </View>
            ) : loadError ? (
              <LoadErrorState onRetry={() => fetchData()} fill={false} />
            ) : displayProviders.length === 0 ? (
              // Distinguish "nobody has joined yet" from "your filters matched nothing" —
              // the second is recoverable, so it gets a Clear filters action.
              providers.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateEmoji}>🐹</Text>
                  <Text style={styles.emptyStateTitle}>No stylists yet</Text>
                  <Text style={styles.emptyStateText}>
                    We’re growing! Check back soon — new stylists join every week.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateEmoji}>🔍</Text>
                  <Text style={styles.emptyStateTitle}>No matches</Text>
                  <Text style={styles.emptyStateText}>
                    No stylists match your search or filters. Try widening the distance or clearing them.
                  </Text>
                  <TouchableOpacity
                    style={styles.clearFiltersBtn}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setSearch('')
                      setSelectedCategory('All')
                      setDistanceFilter('Any')
                      setVerifiedOnly(false)
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.clearFiltersText}>Clear filters</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={displayProviders}
                keyExtractor={p => p.id}
                contentContainerStyle={styles.nearbyRow}
                renderItem={({ item: p }) => (
                  <TouchableOpacity
                    style={styles.nearbyCard}
                    onPress={() => openProvider(p.id)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.nearbyAvatarWrap}>
                      {p.profile_pic_url ? (
                        <Image source={{ uri: p.profile_pic_url }} style={styles.nearbyAvatar} />
                      ) : (
                        <View style={styles.nearbyAvatarPlaceholder}>
                          <Text style={styles.nearbyAvatarInitial}>{p.name[0]?.toUpperCase() ?? '?'}</Text>
                        </View>
                      )}
                      {p.is_verified && (
                        <Ionicons name="checkmark-circle" size={14} color={Colors.rose} style={styles.nearbyVerified} />
                      )}
                    </View>
                    <Text style={styles.nearbyName} numberOfLines={1}>{p.name}</Text>
                    {p.distance != null && (
                      <View style={styles.nearbyDistRow}>
                        <Ionicons name="location" size={10} color={Colors.roseDark} />
                        <Text style={styles.nearbyDist}>{formatDistance(p.distance)}</Text>
                      </View>
                    )}
                    {p.rating != null && (
                      <View style={styles.nearbyRatingRow}>
                        <Ionicons name="star" size={10} color="#F59E0B" />
                        <Text style={styles.nearbyRating}>{p.rating.toFixed(1)}</Text>
                      </View>
                    )}
                    {p.provider_treatments.length > 0 && (
                      <View style={[styles.nearbyPill, {
                        backgroundColor: (CATEGORY_COLOR[p.provider_treatments[0].category] ?? Colors.muted) + '22',
                      }]}>
                        <Text style={[styles.nearbyPillText, {
                          color: CATEGORY_COLOR[p.provider_treatments[0].category] ?? Colors.muted,
                        }]} numberOfLines={1}>
                          {p.provider_treatments[0].category}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </Section>

          {/* ── Subscription status ── */}
          {isVerified && (
            <Section title="Subscription">
              <View style={styles.subCard}>
                <View style={styles.subIconWrap}>
                  <Ionicons name="diamond-outline" size={22} color={Colors.roseDark} />
                </View>
                <View style={styles.subInfo}>
                  <Text style={styles.subStatusText}>Verified</Text>
                  {subscription?.periodEnd ? (
                    <Text style={styles.subRenew}>Renews {formatPeriodEnd(subscription.periodEnd)}</Text>
                  ) : null}
                </View>
                <View style={styles.subBadge}>
                  <Text style={styles.subBadgeText}>Verified</Text>
                </View>
              </View>
            </Section>
          )}

          {/* ── Your impact ── */}
          {impact != null && impact.completed > 0 && (
            <Section title="Your impact">
              <View style={styles.impactRow}>
                <View style={styles.impactStat}>
                  <Text style={styles.impactNum}>{impact.completed}</Text>
                  <Text style={styles.impactLabel}>
                    {impact.completed === 1 ? 'treatment' : 'treatments'}{'\n'}completed
                  </Text>
                </View>
                {impact.distinctProviders > 0 && (
                  <View style={styles.impactStat}>
                    <Text style={styles.impactNum}>{impact.distinctProviders}</Text>
                    <Text style={styles.impactLabel}>
                      {impact.distinctProviders === 1 ? 'stylist' : 'stylists'}{'\n'}helped
                    </Text>
                  </View>
                )}
              </View>
            </Section>
          )}

          <View style={styles.bottomPad} />
        </ScrollView>
      </SafeAreaView>
      <CancelSheet
        visible={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        sessionId={cancelTarget?.id ?? ''}
        otherName={cancelTarget?.name ?? 'them'}
        shortNotice={cancelTarget?.shortNotice ?? false}
        onCancelled={() => { setCancelTarget(null); fetchData() }}
      />

    </View>
  )
}  // end ModelHomeContent

// ── Favourite strip card ─────────────────────────────────────────────────────

/**
 * A dashboard section with a collapsible body.
 *
 * ⚠️ MODULE SCOPE, NOT INSIDE THE SCREEN. A component declared during render
 * gets a new identity every render, so React unmounts and remounts it and its
 * useState starts over — here that would collapse every open section the moment
 * anything else on the dashboard changed. That is audit item 26, which cost a
 * banned-words list in the admin console on 7 Sep. Same mistake, different app.
 *
 * `boxed` gives the section a border and a card background. The updates feed
 * uses it so it reads as a feed rather than as one more heading with things
 * under it.
 */
function Section({
  title, children, boxed = false, right, defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  boxed?: boolean
  /** Rendered at the right of the header, inside the row but outside the
   *  collapse toggle — a control there must not swallow the tap. */
  right?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={boxed ? styles.sectionBoxed : styles.section}>
      <View style={styles.sectionHeaderRow}>
        <TouchableOpacity
          style={styles.sectionHeaderBtn}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setOpen(v => !v)
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, ${open ? 'collapse' : 'expand'}`}
        >
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>{title}</Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={Colors.muted}
          />
        </TouchableOpacity>
        {right}
      </View>
      {open ? children : null}
    </View>
  )
}

/**
 * One stylist update, as a message rather than a notice.
 *
 * The avatar and the name are the link to the profile; the bubble is not
 * tappable. Making the whole row one target read as a system notice rather than
 * as a person saying something — the same decision as the web feed, and the
 * reason that one was restyled on 7 Sep.
 *
 * The bubble is translucent so it sits on the page rather than becoming a second
 * card, and its tail is drawn OUTSIDE the bubble's own box: two overlapping
 * translucent shapes show a darker seam where they cross.
 */
function UpdateRow({ update, onOpen }: { update: StylistUpdate; onOpen: () => void }) {
  return (
    <View style={styles.updateRow}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.8} style={styles.updateAvatarBtn}>
        {update.picUrl ? (
          <Image source={{ uri: update.picUrl }} style={styles.updateAvatar} />
        ) : (
          <View style={styles.updateAvatarPlaceholder}>
            <Text style={styles.updateAvatarInitial}>
              {update.name[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.updateBody}>
        <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
          <Text style={styles.updateName} numberOfLines={1}>{update.name}</Text>
        </TouchableOpacity>
        <View style={styles.updateBubbleWrap}>
          <View style={styles.updateTail} />
          <View style={styles.updateBubble}>
            <Text style={styles.updateText}>{update.body}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

function FavouriteCard({ provider, onPress }: { provider: Provider; onPress: () => void }) {
  const cats = provider.provider_treatments.map(t => t.category).slice(0, 2)
  return (
    <TouchableOpacity style={styles.favCard} onPress={onPress} activeOpacity={0.85}>
      {provider.profile_pic_url ? (
        <Image source={{ uri: provider.profile_pic_url }} style={styles.favAvatar} />
      ) : (
        <View style={styles.favAvatarPlaceholder}>
          <Text style={styles.favAvatarInitial}>{provider.name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <Text style={styles.favName} numberOfLines={1}>{provider.name}</Text>
      <View style={styles.favPills}>
        {cats.map(cat => (
          <View key={cat} style={[styles.favPill, { backgroundColor: CATEGORY_COLOR[cat] ?? Colors.muted }]}>
            <Text style={styles.favPillText}>{cat}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  safe:      { flex: 1 },
  scroll:    { paddingBottom: 24 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 12,
    paddingBottom: 4,
  },
  titleIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageTitle: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.rose,
    letterSpacing: -0.3,
  },
  // Nearby stylists — header (title + Filter), search bar (mirrors provider dashboard)
  nearbySearchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 12,
  },
  nearbySearchInput: {
    flex: 1, fontSize: 14, color: Colors.warmDark, padding: 0,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    flexShrink: 0,
    backgroundColor: Colors.softPink + '40',
    borderWidth: 1,
    borderColor: Colors.rose + '40',
  },
  filterBtnActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  filterBtnText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.softPink,
  },
  profileBtnImg: {
    width: '100%',
    height: '100%',
  },
  profileBtnPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.softPink + '50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Nearby horizontal list
  nearbyRow: { gap: 12, paddingBottom: 4 },
  nearbyCard: {
    width: 120, backgroundColor: Colors.white, borderRadius: 18,
    padding: 12, alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  nearbyAvatarWrap: { position: 'relative' },
  nearbyAvatar: { width: 64, height: 64, borderRadius: 32 },
  nearbyAvatarPlaceholder: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center',
  },
  nearbyAvatarInitial: { fontSize: 22, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  nearbyVerified: { position: 'absolute', bottom: 0, right: -2 },
  nearbyName: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.warmDark, textAlign: 'center' },
  nearbyDistRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  nearbyDist: { fontSize: 11, color: Colors.roseDark, fontFamily: Fonts.bodyBold },
  nearbyRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  nearbyRating: { fontSize: 11, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  nearbyPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 100 },
  nearbyPillText: { fontSize: 10, fontFamily: Fonts.bodyBold, textAlign: 'center' },

  // Filter panel (inside the Nearby stylists section — mirrors provider dashboard)
  filterPanel: {
    backgroundColor: Colors.white,
    borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
    gap: 12,
  },
  filterPanelLabel: {
    fontSize: 11, fontFamily: Fonts.bodyBold, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  distChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.inputBg,
  },
  distChipActive: { backgroundColor: Colors.roseDark, borderColor: Colors.roseDark },
  distChipDisabled: { opacity: 0.35 },
  filterPanelNote: { fontSize: 11, color: Colors.muted, lineHeight: 15, marginTop: 2 },
  distChipText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.muted },
  distChipTextActive: { color: Colors.white },
  verifiedToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  verifiedToggleLabel: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },

  sectionBoxed: {
    marginTop: 20,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  // min-height 44 so the whole header is a comfortable tap target, not just
  // the chevron.
  sectionHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 44, flexShrink: 1,
  },

  // ── Stylist updates ──
  updateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  updateAvatarBtn: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  updateAvatar: { width: 44, height: 44, borderRadius: 22 },
  updateAvatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center',
  },
  updateAvatarInitial: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.roseDark },
  updateBody: { flex: 1, minWidth: 0 },
  updateName: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.warmDark },
  updateBubbleWrap: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 3 },
  // Drawn as a triangle to the LEFT of the bubble, never overlapping it.
  // Full-strength softPink, not 70%. At 0.7 on the cream page background the
  // bubble washed out and the message read as loose text rather than as
  // something somebody said.
  updateTail: {
    width: 0, height: 0,
    borderTopWidth: 0,
    borderRightWidth: 8, borderRightColor: Colors.softPink,
    borderBottomWidth: 8, borderBottomColor: 'transparent',
  },
  updateBubble: {
    flex: 1,
    backgroundColor: Colors.softPink,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  updateText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.warmDark, lineHeight: 19 },
  updatesEmpty: {
    fontFamily: Fonts.body, fontSize: 13, color: Colors.muted,
    lineHeight: 18, marginTop: 6,
  },
  updatesMoreBtn: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  updatesMoreText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.roseDark },
  sectionTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: Colors.warmDark,
    letterSpacing: -0.2,
    marginBottom: 12,
  },

  emptyFavs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyFavsEmoji: { fontSize: 22 },
  emptyFavsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },

  favsRow: {
    gap: 12,
  },
  favCard: {
    width: 110,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  favAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  favAvatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  favAvatarInitial: {
    fontSize: 22,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },
  favName: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    marginBottom: 6,
    textAlign: 'center',
  },
  favPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'center',
  },
  favPill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  favPillText: {
    fontSize: 10,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  clearFiltersBtn: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.rose,
  },
  clearFiltersText: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.white },
  emptyStateEmoji: { fontSize: 40, marginBottom: 12 },
  emptyStateTitle: {
    fontSize: 17,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Dashboard cards ──
  dashCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  // Upcoming treatments — horizontal cards
  upcomingScroll: { gap: 12, paddingRight: 16, paddingBottom: 4 },
  upcomingCard: {
    width: 230,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  upcomingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upcomingStatus: { alignSelf: 'flex-start' },

  dashAvatarWrap: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  dashAvatar: { width: 44, height: 44, borderRadius: 22 },
  dashAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashAvatarInitial: { fontSize: 18, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  dashInfo: { flex: 1, gap: 3 },
  dashTitle: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  dashMeta: { fontSize: 13, color: Colors.muted },
  dashTag: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.softPink,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 2,
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    overflow: 'hidden',
  },
  // Cancel, on the card rather than behind a menu. Muted so it does not
  // compete with the primary action, labelled so it is not a guess.
  cardCancel: { marginTop: 8, minHeight: 32, justifyContent: 'center' },
  cardCancelText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.muted },

  dashStatusBadge: {
    backgroundColor: Colors.softPink,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dashStatusText: { fontSize: 11, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  reviewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.rose, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0,
  },
  reviewPillText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.white },
  dashStatusPending: { backgroundColor: '#FFF3CD' },
  dashStatusTextPending: { color: '#856404' },

  attentionLabel: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Subscription card ──
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  subIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subInfo: { flex: 1 },
  subStatusText: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  subRenew: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  subBadge: {
    backgroundColor: Colors.roseDark,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  subBadgeText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: '#fff' },

  // ── Impact stats ──
  impactRow: {
    flexDirection: 'row',
    gap: 12,
  },
  impactStat: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  impactNum: { fontSize: 32, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  impactLabel: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },

  bottomPad: { height: 20 },
  wrongScreenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.roseDark,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  wrongScreenText: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
    lineHeight: 21,
  },
})
