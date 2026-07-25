import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors, Fonts } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { getBlockedIds } from '@/lib/blocks'
import { signModelPhotos } from '@/lib/photoUrls'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'
import HeaderIcons from '@/components/HeaderIcons'
import ApplicationPhotos from '@/components/ApplicationPhotos'
import PhotoViewerModal from '@/components/PhotoViewerModal'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  nails:      CategoryColors.nails,
  lashes:     CategoryColors.lashes,
  brows:      CategoryColors.brows,
  hair:       CategoryColors.hair,
  makeup:     CategoryColors.makeup,
  'spray tan':CategoryColors.sprayTan,
}

function categoryColor(cat: string | null | undefined) {
  return CATEGORY_COLORS[(cat ?? '').toLowerCase()] ?? Colors.roseDark
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = {
  id: string
  name: string
  profile_pic_url: string | null
  is_verified: boolean | null
  rating: number | null
  review_count: number | null
  is_published: boolean | null
  shop_handle: string | null
}

type ModelCard = {
  id: string
  name: string
  profile_pic_url: string | null
  hair_colour: string | null
  hair_type: string | null
  hair_length: string | null
  skin_tone: string | null
  is_verified: boolean
  distance: number | null
}

type SessionCard = {
  id: string
  model_user_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
  note: string | null
  // Signed urls for the photos the model attached when applying (private bucket).
  photoUrls: string[]
  created_at: string
  status: 'pending' | 'accepted'
  modelName: string
  modelPicUrl: string | null
  treatmentName: string | null
  treatmentCategory: string | null
}

type ReviewCard = {
  id: string
  modelName: string
  modelPicUrl: string | null
  date: string
  treatmentName: string | null
  treatmentCategory: string | null
}

type Stats = {
  totalSessions: number
  portfolioCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDistance(d: number): string {
  if (d < 0.1) return 'nearby'
  if (d < 10) return `${d.toFixed(1)} mi`
  return `${Math.round(d)} mi`
}

function formatSessionDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function formatTime(t: string) {
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, hint }: { label: string; value: string; icon: string; hint?: string }) {
  return (
    <View style={statStyles.card}>
      {/* Tappable affordance */}
      <Ionicons name="chevron-forward" size={13} color={Colors.roseDark} style={statStyles.chevron} />
      <Ionicons name={icon as any} size={20} color={Colors.roseDark} />
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label} numberOfLines={2}>{label}</Text>
      {hint ? <Text style={statStyles.hint}>{hint}</Text> : null}
    </View>
  )
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    position: 'relative',
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.softPink,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  chevron: {
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: 0.7,
  },
  value: {
    fontSize: 24,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  hint: {
    fontSize: 10,
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
  },
})

// ── Provider not found — auto sign-out ────────────────────────────────────────

function ProviderNotFound({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.container, styles.centred]}>
      <Ionicons name="refresh-circle-outline" size={48} color={Colors.rose} />
      <Text style={[styles.emptyLabel, { marginTop: 16, fontSize: 17, color: Colors.warmDark }]}>
        Setting up your profile…
      </Text>
      <Text style={[styles.emptyLabel, { fontSize: 14, color: Colors.muted, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }]}>
        Your stylist profile couldn't be created yet. Pull to refresh or tap below to try again.
      </Text>
      <TouchableOpacity
        style={[styles.goBackBtn, { marginTop: 20 }]}
        onPress={onRetry}
      >
        <Text style={styles.goBackText}>Try again</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProviderDashboardScreen() {
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id

  const [provider,          setProvider]          = useState<Provider | null>(null)
  // Verified status kept as its own state (not only inside `provider`) so a focus
  // re-sync can't be dropped when `provider` is momentarily null. The shop toggle,
  // banner and badge read THIS. Written by both load() and the focus effect.
  const [isVerified,        setIsVerified]        = useState(false)
  // Provider fee is "settled" when they paid the £14.99, OR were granted free
  // access (founding / admin waive). Publishing requires verified AND settled —
  // identity alone is NOT enough (models are identity-verified for free).
  const [feeSettled,        setFeeSettled]        = useState(false)
  const [pendingSessions,   setPendingSessions]   = useState<SessionCard[]>([])
  const [upcomingSessions,  setUpcomingSessions]  = useState<SessionCard[]>([])
  const [toReview,          setToReview]          = useState<ReviewCard[]>([])
  const [stats,             setStats]             = useState<Stats>({ totalSessions: 0, portfolioCount: 0 })
  const [nearbyModels,      setNearbyModels]      = useState<ModelCard[]>([])
  // Mutually-blocked user ids (either direction) — filtered out of applications & nearby.
  const [blockedIds,        setBlockedIds]        = useState<Set<string>>(new Set())
  const [nearbyLoading,     setNearbyLoading]     = useState(true)
  // Location unavailable (permission denied or GPS failed). Without this the nearby
  // effect waits on coords that will never arrive and spins forever.
  const [locationDenied,    setLocationDenied]    = useState(false)
  const [modelSearch,       setModelSearch]       = useState('')
  const [showModelFilters,  setShowModelFilters]  = useState(false)
  const [filterHairColour,  setFilterHairColour]  = useState<string | null>(null)
  const [filterHairType,    setFilterHairType]    = useState<string | null>(null)
  const [filterHairLength,  setFilterHairLength]  = useState<string | null>(null)
  const [filterSkinTone,    setFilterSkinTone]    = useState<string | null>(null)
  const [filterDistanceMi,  setFilterDistanceMi]  = useState<number | null>(null)
  const [filterVerified,    setFilterVerified]    = useState(false)
  const [providerLat,       setProviderLat]       = useState<number | null>(null)
  const [providerLng,       setProviderLng]       = useState<number | null>(null)
  const [loading,           setLoading]           = useState(true)
  const [loadError,         setLoadError]         = useState(false)
  const [refreshing,        setRefreshing]        = useState(false)
  const [publishLoading,    setPublishLoading]    = useState(false)
  const [processingIds,     setProcessingIds]     = useState<Set<string>>(new Set())
  // Signed url of the application photo being viewed full-screen, if any.
  const [enlargedPhoto,     setEnlargedPhoto]     = useState<string | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) return
    if (!isRefresh) setLoading(true)
    setLoadError(false)

    try {
      // Phase 1: fetch user profile + provider row + provider-fee status in parallel.
      const [{ data: userRow }, { data: provRow }, { data: payRow }] = await Promise.all([
        supabase.from('users').select('first_name, last_initial, profile_pic_url, is_verified, is_founding_provider, provider_fee_waived').eq('id', userId).single(),
        supabase.from('providers').select('id, user_id, bio, is_published, shop_handle, rating, review_count').eq('user_id', userId).maybeSingle(),
        supabase.from('verification_payments').select('id').eq('user_id', userId).limit(1).maybeSingle(),
      ])

      const userVerified = !!(userRow as any)?.is_verified
      setIsVerified(userVerified)
      // Fee settled = paid the £14.99, OR founding provider, OR admin-waived (free access).
      const settled = !!payRow || !!(userRow as any)?.is_founding_provider || !!(userRow as any)?.provider_fee_waived
      setFeeSettled(settled)
      const first       = (userRow as any)?.first_name ?? ''
      const initial     = (userRow as any)?.last_initial ?? ''
      const displayName = first ? `${first}${initial ? ` ${initial}.` : ''}`.trim() : 'Stylist'
      const userPic     = (userRow as any)?.profile_pic_url ?? null

      let resolvedProv: Provider | null = null

      const buildProvider = (id: string, isPublished: boolean | null = null, shopHandle: string | null = null, rating: number | null = null, reviewCount: number | null = null): Provider => ({
        id,
        name:            displayName,
        profile_pic_url: userPic,
        is_verified:     userVerified,
        rating,
        review_count:    reviewCount,
        is_published:    isPublished,
        shop_handle:     shopHandle,
      } as unknown as Provider)

      if (provRow) {
        resolvedProv = buildProvider(
          (provRow as any).id,
          (provRow as any).is_published ?? null,
          (provRow as any).shop_handle ?? null,
          (provRow as any).rating ?? null,
          (provRow as any).review_count ?? null,
        )
      } else {
        const handle = `${first}${initial ? '-' + initial : ''}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'stylist'

        const { data: created, error: insertErr } = await supabase
          .from('providers')
          .insert({
            user_id:       userId,
            shop_handle:   handle,
            level:         'beginner',
            region:        'UK',
            name:          displayName,
            is_published:  false,   // start hidden until pay + verify (admin approval publishes)
            location_text: '',
          })
          .select('id')
          .single()

        if (insertErr) {
          // Log the raw Postgres detail for us; show the stylist something human.
          console.error('provider-dashboard: providers insert failed:', insertErr)
          Alert.alert(
            'Couldn’t finish setting up your shop',
            'Please pull down to refresh. If this keeps happening, contact support@guineapigapp.co.uk.',
          )
        }

        if (created) {
          resolvedProv = buildProvider((created as any).id, true, handle)
        } else {
          // Insert may have raced — fetch one more time before giving up
          const { data: refetched } = await supabase
            .from('providers')
            .select('id, shop_handle')
            .eq('user_id', userId)
            .maybeSingle()
          if (refetched) resolvedProv = buildProvider((refetched as any).id, null, (refetched as any).shop_handle ?? null)
        }
      }

      setProvider(resolvedProv)
      if (!resolvedProv) {
        setLoading(false)
        setRefreshing(false)
        return
      }
      const providerId = resolvedProv.id

      // Phase 2: parallel fetches
      const today = todayKey()
      const [
        { data: pendingData },
        { data: upcomingData },
        { count: totalCount },
        { count: portfolioCount },
        { data: completedData },
      ] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, model_user_id, date, start_time, end_time, treatment_id, note, photo_urls, created_at')
          .eq('provider_id', providerId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase
          .from('sessions')
          .select('id, model_user_id, date, start_time, end_time, treatment_id, created_at')
          .eq('provider_id', providerId)
          .eq('status', 'accepted')
          .gte('date', today)
          .order('date', { ascending: true })
          .limit(10),
        supabase
          .from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerId)
          .in('status', ['accepted', 'completed']),
        supabase
          .from('portfolio_items')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerId),
        supabase
          .from('sessions')
          .select('id, model_user_id, date, treatment_id')
          .eq('provider_id', providerId)
          .eq('status', 'completed')
          .order('date', { ascending: false }),
      ])

      setStats({
        totalSessions: totalCount ?? 0,
        portfolioCount: portfolioCount ?? 0,
      })

      // NOTE: nearby models are fetched separately in their own effect below, which
      // re-runs on [providerLat, providerLng, filterDistanceMi] since the RPC computes
      // distance at fetch time and those are its inputs.

      // Phase 3: enrich sessions with model + treatment info
      const completedRows = (completedData ?? []) as any[]
      const completedIds = completedRows.map((s: any) => s.id as string)
      const allSessions = [...(pendingData ?? []), ...(upcomingData ?? []), ...completedRows]
      if (allSessions.length === 0) {
        setPendingSessions([])
        setUpcomingSessions([])
        setToReview([])
        setLoading(false)
        setRefreshing(false)
        return
      }

      const modelIds = [...new Set(allSessions.map((s: any) => s.model_user_id))]
      const treatIds = [
        ...new Set(
          allSessions.map((s: any) => s.treatment_id).filter((id: any): id is string => !!id)
        ),
      ]

      const [{ data: modelsData }, { data: treatsData }, { data: myReviews }] = await Promise.all([
        supabase
          .from('public_profiles')
          .select('id, first_name, last_initial, profile_pic_url')
          .in('id', modelIds),
        treatIds.length > 0
          ? supabase
              .from('provider_treatments')
              .select('id, name, category')
              .in('id', treatIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        completedIds.length > 0
          ? supabase
              .from('reviews')
              .select('session_id')
              .eq('reviewer_id', userId)
              .in('session_id', completedIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      const reviewedSet = new Set((myReviews ?? []).map((r: any) => r.session_id as string))

      const modelMap: Record<string, any>  = {}
      const treatMap: Record<string, any>  = {}
      ;(modelsData ?? []).forEach((m: any) => { modelMap[m.id] = m })
      ;(treatsData ?? []).forEach((t: any) => { treatMap[t.id] = t })

      // Photos the model attached when applying live in a PRIVATE bucket, so the
      // stored paths must be swapped for signed urls before they'll render. One
      // batched call for the whole list. (Only applications need these — the
      // upcoming card is a 230px-wide glance tile with no room for thumbnails;
      // accepted bookings show their photos on the sessions screen instead.)
      const allPhotoPaths = (pendingData ?? [])
        .flatMap((s: any) => (s.photo_urls ?? []) as string[])
      const signedPhotos = allPhotoPaths.length > 0
        ? await signModelPhotos(allPhotoPaths)
        : new Map<string, string>()

      function enrich(s: any): SessionCard {
        const m = modelMap[s.model_user_id]
        const t = s.treatment_id ? treatMap[s.treatment_id] : null
        return {
          id: s.id,
          model_user_id: s.model_user_id,
          date: s.date,
          start_time: s.start_time,
          end_time: s.end_time,
          treatment_id: s.treatment_id ?? null,
          note: s.note ?? null,
          photoUrls: ((s.photo_urls ?? []) as string[]).map(p => signedPhotos.get(p) ?? p),
          created_at: s.created_at,
          status: s.status,
          modelName: m ? `${m.first_name} ${m.last_initial ? m.last_initial + '.' : ''}`.trim() : 'Model',
          modelPicUrl: m?.profile_pic_url ?? null,
          treatmentName: t?.name ?? null,
          treatmentCategory: t?.category ?? null,
        }
      }

      // Mutual block: hide applications from blocked models (either direction).
      const blocked = await getBlockedIds(userId).catch(() => new Set<string>())
      setBlockedIds(blocked)
      setPendingSessions((pendingData ?? []).filter((s: any) => !blocked.has(s.model_user_id)).map(enrich))
      setUpcomingSessions((upcomingData ?? []).map(enrich))
      setToReview(completedRows
        .filter((s: any) => !reviewedSet.has(s.id as string) && !blocked.has(s.model_user_id))
        .map((s: any) => {
          const m = modelMap[s.model_user_id]
          const t = s.treatment_id ? treatMap[s.treatment_id] : null
          return {
            id: s.id as string,
            modelName: m ? `${m.first_name} ${m.last_initial ? m.last_initial + '.' : ''}`.trim() : 'Model',
            modelPicUrl: m?.profile_pic_url ?? null,
            date: s.date as string,
            treatmentName: t?.name ?? null,
            treatmentCategory: t?.category ?? null,
          }
        }))
    } catch (e) {
      console.error('provider-dashboard load failed:', e)
      setLoadError(true)
    }

    setLoading(false)
    setRefreshing(false)
  }, [userId])

  // Load loud on mount, then silently re-load on every focus so lists (incl.
  // "to review") refresh after actions like leaving a review. load(true) skips
  // the loading flash.
  const loadedOnce = useRef(false)
  useFocusEffect(
    useCallback(() => {
      load(loadedOnce.current)
      loadedOnce.current = true
    }, [load])
  )

  // Lightweight re-sync on focus: after an admin approves verification (is_verified)
  // and publishes the shop (is_published), returning to the dashboard should reflect
  // it without a manual reload — so the shop toggle enables. Cheap targeted fetch, no
  // loading flash (unlike re-running the full load()).
  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      let cancelled = false
      ;(async () => {
        const [{ data: u }, { data: pr }, { data: pay }] = await Promise.all([
          supabase.from('users').select('is_verified, is_founding_provider, provider_fee_waived').eq('id', userId).single(),
          supabase.from('providers').select('is_published').eq('user_id', userId).maybeSingle(),
          supabase.from('verification_payments').select('id').eq('user_id', userId).limit(1).maybeSingle(),
        ])
        if (cancelled) return
        const v = !!(u as any)?.is_verified
        // Apply verified to its own state — this can NEVER be dropped, even if
        // `provider` is still null (focus fired before load() finished).
        setIsVerified(v)
        // Re-derive fee-settled too, so paying the £14.99 and returning enables the toggle.
        setFeeSettled(!!pay || !!(u as any)?.is_founding_provider || !!(u as any)?.provider_fee_waived)
        // Publish flag lives on `provider`; merge when present (harmless if null —
        // load() will set it). Log whether provider existed at merge time.
        setProvider(p => {
          if (!p) return p
          const pub = pr ? !!(pr as any).is_published : p.is_published
          return (p.is_verified === v && p.is_published === pub) ? p : { ...p, is_verified: v, is_published: pub }
        })
      })()
      return () => { cancelled = true }
    }, [userId])
  )

  useEffect(() => {
    if (!userId) return
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      // Denied → coords stay null forever, so the nearby effect would spin indefinitely.
      // Flag it instead so the section can explain itself and stop loading.
      if (status !== 'granted') { setLocationDenied(true); setNearbyLoading(false); return }
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(async loc => {
        const lat = loc.coords.latitude
        const lng = loc.coords.longitude
        setProviderLat(lat)
        setProviderLng(lng)
        await Promise.all([
          supabase.from('users').update({ latitude: lat, longitude: lng }).eq('id', userId),
          supabase.from('providers').update({ latitude: lat, longitude: lng }).eq('user_id', userId),
        ]).catch(() => {})
      }).catch(() => { setLocationDenied(true); setNearbyLoading(false) })
    }).catch(() => { setLocationDenied(true); setNearbyLoading(false) })
  }, [userId])

  // ── Nearby models ────────────────────────────────────────────────────────────
  // The nearby_models RPC computes distance at fetch time, so this must re-run when
  // its inputs change — hence its own effect keyed on [providerLat, providerLng,
  // filterDistanceMi], separate from load()'s [userId]. Cold-load waits for GPS
  // (coords start null); a distance-filter change refetches.
  useEffect(() => {
    // Guard: no coords yet (GPS still resolving) → skip RPC, stay in loading state.
    // If location was denied/failed the coords will never arrive, so don't spin.
    if (providerLat == null || providerLng == null) {
      setNearbyLoading(!locationDenied)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('nearby_models', {
        p_lat: providerLat,
        p_lng: providerLng,
        p_radius_mi: filterDistanceMi,
      })
      if (cancelled) return // a newer fetch (coords/filter changed) superseded this one
      if (data) {
        setNearbyModels((data as any[]).map(m => ({
          id:              m.id,
          name:            `${m.first_name ?? ''}${m.last_initial ? ' ' + m.last_initial + '.' : ''}`.trim() || 'Model',
          profile_pic_url: m.profile_pic_url ?? null,
          // nearby_models LEFT JOINs model_attributes, so these are present but null for
          // models who haven't filled in their profile — the cards just drop those chips.
          hair_colour:     m.hair_colour ?? null,
          hair_type:       m.hair_type ?? null,
          hair_length:     m.hair_length ?? null,
          skin_tone:       m.skin_tone ?? null,
          is_verified:     !!(m.is_verified),
          distance:        m.distance_mi ?? null,
        })))
      }
      setNearbyLoading(false)
    })()
    return () => { cancelled = true }
  }, [providerLat, providerLng, filterDistanceMi, locationDenied])

  const onRefresh = () => {
    setRefreshing(true)
    load(true)
  }

  // ── Accept / Decline ───────────────────────────────────────────────────────

  const setProcessing = (id: string, on: boolean) => {
    setProcessingIds(prev => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  const acceptSession = async (s: SessionCard) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setProcessing(s.id, true)
    try {
      await supabase.from('sessions').update({ status: 'accepted' }).eq('id', s.id)
      try {
        const { error } = await supabase.from('notifications').insert({
          user_id: s.model_user_id,
          type: 'session_accepted',
          title: 'Treatment accepted! 🎉',
          body: `Your booking for ${formatSessionDate(s.date)} has been confirmed.`,
          session_id: s.id,
        })
        if (error) console.error('accept session notification failed:', error)
      } catch (e) { console.error('accept session notification failed:', e) }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPendingSessions(prev => prev.filter(x => x.id !== s.id))
      if (s.date >= todayKey()) {
        setUpcomingSessions(prev =>
          [...prev, { ...s, status: 'accepted' as const }].sort((a, b) => a.date.localeCompare(b.date))
        )
      }
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', 'Could not accept treatment. Please try again.')
    }
    setProcessing(s.id, false)
  }

  const declineSession = async (s: SessionCard) => {
    Alert.alert(
      'Decline treatment?',
      `This will decline ${s.modelName}'s application for ${formatSessionDate(s.date)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setProcessing(s.id, true)
            try {
              await supabase.from('sessions').update({ status: 'declined' }).eq('id', s.id)
              try {
                const { error } = await supabase.from('notifications').insert({
                  user_id: s.model_user_id,
                  type: 'session_declined',
                  title: 'Treatment update',
                  body: `Your booking for ${formatSessionDate(s.date)} was not confirmed.`,
                  session_id: s.id,
                })
                if (error) console.error('decline session notification failed:', error)
              } catch (e) { console.error('decline session notification failed:', e) }
              setPendingSessions(prev => prev.filter(x => x.id !== s.id))
            } catch {
              Alert.alert('Error', 'Could not decline treatment. Please try again.')
            }
            setProcessing(s.id, false)
          },
        },
      ]
    )
  }

  // ── Published toggle ───────────────────────────────────────────────────────

  const togglePublished = async (value: boolean) => {
    if (!provider) return

    // Going live requires BOTH identity verification AND the provider fee settled
    // (paid £14.99 / founding / admin-waived). Identity alone is not enough — models
    // are identity-verified for free, so is_verified is not proof of payment.
    if (value && !isVerified) {
      Alert.alert('Verify first', 'Get verified to make your shop live.')
      return
    }
    if (value && !feeSettled) {
      Alert.alert('Payment needed', 'Pay the £14.99 verification fee to make your shop live.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Pay now', onPress: () => router.push('/(app)/verify-payment' as any) },
      ])
      return
    }

    if (value) {
      const { count } = await supabase
        .from('provider_treatments')
        .select('id', { count: 'exact', head: true })
        .eq('provider_id', provider.id)
      if (!count || count === 0) {
        Alert.alert(
          'Add treatments first',
          'You need to add at least one treatment before going live so models know what you offer.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Edit Shop', onPress: goEditShop },
          ],
        )
        return
      }
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPublishLoading(true)
    try {
      const { error: toggleErr } = await supabase
        .from('providers')
        .update({ is_published: value })
        .eq('id', provider.id)
      if (toggleErr) throw toggleErr
      setProvider(p => p ? { ...p, is_published: value } : p)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    setPublishLoading(false)
  }

  // ── Quick links ────────────────────────────────────────────────────────────

  const handleInvite = async (m: ModelCard) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { error } = await supabase.from('notifications').insert({
      user_id:    m.id,
      type:       'stylist_invite',
      title:      `${provider?.name ?? 'A stylist'} wants you as their model`,
      body:       'Tap to view their shop',
      session_id: null,
      data:       { provider_id: provider?.id ?? null, shop_handle: provider?.shop_handle ?? null },
    })
    if (error) {
      console.error('[handleInvite] insert error:', error.message)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Invite failed', error.message)
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Invite sent!', `We'll let ${m.name.split(' ')[0]} know you're available.`)
  }

  const goAvailability = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(app)/availability' as any)
  }

  const goEditShop = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(app)/edit-shop' as any)
  }

  const goPortfolio = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(app)/portfolio' as any)
  }

  const goShop = async () => {
    if (!provider) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({
      pathname: '/(app)/provider/[id]' as any,
      params: { id: provider.id, ownShop: '1' },
    })
  }

  const goModelProfile = async (modelId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/model/[id]' as any, params: { id: modelId } })
  }

  const goChat = async (sessionId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({
      pathname: '/(app)/chat/[sessionId]' as any,
      params: { sessionId },
    })
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState onRetry={() => load()} />
      </View>
    )
  }

  if (!provider) {
    return <ProviderNotFound onRetry={() => load()} />
  }

  const isPublished = !!provider.is_published
  const providerInitials = provider.name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenDecor />
      {/* ── Header bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBarLeft}>
          <Text style={styles.greeting}>Dashboard</Text>
          <Text style={styles.subGreeting}>Welcome back, {provider.name.split(' ')[0]}</Text>
        </View>
        <View style={styles.topBarRight}>
          <HeaderIcons />
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push('/(app)/settings' as any)
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="settings-outline" size={19} color={Colors.warmDark} />
          </TouchableOpacity>
          <View>
            {provider.profile_pic_url ? (
              <Image source={{ uri: provider.profile_pic_url }} style={styles.headerAvatar} />
            ) : (
              <View style={styles.headerAvatarPlaceholder}>
                <Text style={styles.headerAvatarInitials}>{providerInitials}</Text>
              </View>
            )}
            {isVerified && (
              <View style={styles.verifiedDot}>
                <Ionicons name="checkmark" size={9} color={Colors.white} />
              </View>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.roseDark}
            colors={[Colors.roseDark]}
          />
        }
      >
        {/* ── Shop status card ── */}
        <View style={styles.shopCard}>
          <View style={styles.shopCardLeft}>
            <View style={[styles.shopStatusDot, { backgroundColor: isPublished ? Colors.rose : Colors.muted }]} />
            <View>
              <Text style={styles.shopCardTitle}>Shop status</Text>
              <Text style={[styles.shopCardStatus, { color: isPublished ? Colors.rose : Colors.muted }]}>
                {isPublished ? 'Live — models can find you' : 'Offline — hidden from search'}
              </Text>
            </View>
          </View>
          {publishLoading ? (
            <ActivityIndicator size="small" color={Colors.roseDark} />
          ) : (isVerified && feeSettled) ? (
            <Switch
              value={isPublished}
              onValueChange={togglePublished}
              trackColor={{ false: Colors.border, true: Colors.rose }}
              thumbColor={isPublished ? Colors.roseDark : Colors.muted}
              ios_backgroundColor={Colors.border}
            />
          ) : (
            <View style={styles.publishLocked}>
              <Switch
                value={false}
                disabled
                trackColor={{ false: Colors.border, true: Colors.border }}
                thumbColor={Colors.border}
                ios_backgroundColor={Colors.border}
              />
              <Text style={styles.publishHint}>
                {!isVerified ? 'Verify to make your shop live' : 'Pay the £14.99 fee to make your shop live'}
              </Text>
            </View>
          )}
        </View>

        {/* ── Get set up banner (hidden once verified AND fee settled) ── */}
        {!(isVerified && feeSettled) && (
          <TouchableOpacity
            style={styles.verifyBanner}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push('/(app)/verify-payment' as any)
            }}
            activeOpacity={0.9}
          >
            <View style={styles.verifyBannerIcon}>
              <Ionicons name="shield-checkmark-outline" size={26} color={Colors.roseDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.verifyBannerTitle}>{!isVerified ? 'Get verified' : 'Pay to go live'}</Text>
              <Text style={styles.verifyBannerSub}>
                {!isVerified
                  ? 'Verify your identity to make your shop live and start getting bookings.'
                  : 'Pay the £14.99 verification fee to make your shop live and start getting bookings.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.roseDark} />
          </TouchableOpacity>
        )}

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(app)/sessions' as any) }}
            activeOpacity={0.8}
            style={{ flex: 1 }}
          >
            <StatCard
              label="Treatment history"
              value={stats.totalSessions.toString()}
              icon="calendar-outline"
              hint="View all"
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push(`/(app)/reviews/${userId}` as any)
            }}
            activeOpacity={0.8}
            style={{ flex: 1 }}
          >
            <StatCard
              label="Rating"
              value={provider.rating != null ? provider.rating.toFixed(1) : '—'}
              icon="star-outline"
              hint="View all"
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={goPortfolio} activeOpacity={0.8} style={{ flex: 1 }}>
            <StatCard
              label="Portfolio"
              value={stats.portfolioCount.toString()}
              icon="images-outline"
              hint="View all"
            />
          </TouchableOpacity>
        </View>

        {/* ── Pending applications ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Applications</Text>
          {pendingSessions.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingSessions.length}</Text>
            </View>
          )}
        </View>

        {pendingSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name={stats.totalSessions > 0 ? 'checkmark-circle-outline' : 'mail-open-outline'} size={32} color={Colors.muted} />
            <Text style={[styles.emptyCardText, { textAlign: 'center' }]}>
              {stats.totalSessions > 0
                ? 'All applications reviewed'
                : 'No applications yet — they’ll appear here when models apply'}
            </Text>
          </View>
        ) : (
          pendingSessions.map(s => (
            <PendingCard
              key={s.id}
              session={s}
              processing={processingIds.has(s.id)}
              onAccept={() => acceptSession(s)}
              onDecline={() => declineSession(s)}
              onPhotoPress={setEnlargedPhoto}
            />
          ))
        )}

        {/* ── Upcoming sessions ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>
            Upcoming treatments{upcomingSessions.length > 0 ? ` (${upcomingSessions.length})` : ''}
          </Text>
        </View>

        {upcomingSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={Colors.muted} />
            <Text style={styles.emptyCardText}>No confirmed treatments yet</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.upcomingScroll}
          >
            {upcomingSessions.map(s => (
              <UpcomingCard
                key={s.id}
                session={s}
                onChat={() => goChat(s.id)}
              />
            ))}
          </ScrollView>
        )}

        {/* ── Treatments to review ── */}
        {toReview.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>Treatments to review</Text>
            </View>
            {toReview.map(s => (
              <TouchableOpacity
                key={s.id}
                style={styles.reviewRow}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId: s.id, revieweeType: 'model' } })
                }}
                activeOpacity={0.85}
              >
                {s.modelPicUrl ? (
                  <Image source={{ uri: s.modelPicUrl }} style={styles.reviewAvatar} />
                ) : (
                  <View style={[styles.reviewAvatar, styles.reviewAvatarPlaceholder]}>
                    <Text style={styles.reviewAvatarInitial}>{s.modelName[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewName} numberOfLines={1}>{s.modelName}</Text>
                  <Text style={styles.reviewMeta} numberOfLines={1}>{s.treatmentName ? `${s.treatmentName} · ` : ''}How was it?</Text>
                </View>
                <View style={styles.reviewPill}>
                  <Ionicons name="star" size={12} color={Colors.white} />
                  <Text style={styles.reviewPillText}>Review</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── Quick links ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Quick links</Text>
        </View>

        <View style={styles.quickLinks}>
          <TouchableOpacity style={styles.quickLinkBtn} onPress={goAvailability} activeOpacity={0.85}>
            <View style={[styles.quickLinkIcon, { backgroundColor: Colors.softPink + '40' }]}>
              <Ionicons name="calendar" size={22} color={Colors.roseDark} />
            </View>
            <View style={styles.quickLinkText}>
              <Text style={styles.quickLinkTitle}>Manage Availability</Text>
              <Text style={styles.quickLinkSub}>Set your open dates & times</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickLinkBtn} onPress={goShop} activeOpacity={0.85}>
            <View style={[styles.quickLinkIcon, { backgroundColor: Colors.inputBg }]}>
              <Ionicons name="storefront-outline" size={22} color={Colors.warmDark} />
            </View>
            <View style={styles.quickLinkText}>
              <Text style={styles.quickLinkTitle}>View Shop</Text>
              <Text style={styles.quickLinkSub}>See how models see your profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickLinkBtn} onPress={goEditShop} activeOpacity={0.85}>
            <View style={[styles.quickLinkIcon, { backgroundColor: Colors.softPink }]}>
              <Ionicons name="pencil-outline" size={22} color={Colors.roseDark} />
            </View>
            <View style={styles.quickLinkText}>
              <Text style={styles.quickLinkTitle}>Edit Shop</Text>
              <Text style={styles.quickLinkSub}>Update bio, name & location</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
          </TouchableOpacity>
        </View>

        {/* ── Nearby models ── */}
        <View style={[styles.sectionHeader, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Nearby models</Text>
          <TouchableOpacity
            style={[nearbyStyles.filterToggle, showModelFilters && nearbyStyles.filterToggleActive]}
            onPress={() => setShowModelFilters(v => !v)}
            activeOpacity={0.8}
          >
            <Ionicons name="options-outline" size={14} color={showModelFilters ? Colors.white : Colors.roseDark} />
            <Text style={[nearbyStyles.filterToggleText, showModelFilters && { color: Colors.white }]}>Filter</Text>
            {(filterHairColour || filterHairType || filterHairLength || filterSkinTone || filterDistanceMi || filterVerified) && (
              <View style={nearbyStyles.filterDot} />
            )}
          </TouchableOpacity>
        </View>

        {/* Model search */}
        <View style={styles.modelSearchBar}>
          <Ionicons name="search-outline" size={15} color={Colors.muted} />
          <TextInput
            style={styles.modelSearchInput}
            placeholder="Search models by name…"
            placeholderTextColor={Colors.muted}
            value={modelSearch}
            onChangeText={setModelSearch}
          />
          {modelSearch.length > 0 && (
            <TouchableOpacity onPress={() => setModelSearch('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close-circle" size={15} color={Colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter panel */}
        {showModelFilters && (
          <View style={nearbyStyles.filterPanel}>
            <FilterChips
              label="Hair colour"
              options={['Black','Dark Brown','Medium Brown','Light Brown','Blonde','Platinum Blonde','Red','Auburn','Grey','White','Dyed']}
              selected={filterHairColour}
              onSelect={v => setFilterHairColour(v === filterHairColour ? null : v)}
            />
            <FilterChips
              label="Hair type"
              options={['Straight','Wavy','Curly','Coily']}
              selected={filterHairType}
              onSelect={v => setFilterHairType(v === filterHairType ? null : v)}
            />
            <FilterChips
              label="Hair length"
              options={['Short','Medium','Long','Very Long']}
              selected={filterHairLength}
              onSelect={v => setFilterHairLength(v === filterHairLength ? null : v)}
            />
            <FilterChips
              label="Skin tone"
              options={['Fair','Light','Medium','Olive','Brown','Dark Brown','Deep']}
              selected={filterSkinTone}
              onSelect={v => setFilterSkinTone(v === filterSkinTone ? null : v)}
            />
            <FilterChips
              label="Distance"
              options={['Any','1 mi','2 mi','4 mi','10 mi','20 mi']}
              selected={filterDistanceMi != null ? `${filterDistanceMi} mi` : 'Any'}
              onSelect={v => {
                // 'Any' (or clearing) → null radius = no distance cap (show all matching models).
                const parsed = (!v || v === 'Any') ? null : parseInt(v)
                setFilterDistanceMi(parsed)
              }}
            />
            <View style={nearbyStyles.filterRow}>
              <Text style={nearbyStyles.filterLabel}>Verified only</Text>
              <Switch
                value={filterVerified}
                onValueChange={setFilterVerified}
                trackColor={{ false: Colors.border, true: Colors.rose }}
                thumbColor={filterVerified ? Colors.roseDark : Colors.muted}
                ios_backgroundColor={Colors.border}
              />
            </View>
            <TouchableOpacity
              style={nearbyStyles.clearFiltersBtn}
              onPress={() => {
                setFilterHairColour(null); setFilterHairType(null)
                setFilterHairLength(null); setFilterSkinTone(null)
                setFilterDistanceMi(null); setFilterVerified(false)
              }}
            >
              <Text style={nearbyStyles.clearFiltersText}>Clear all filters</Text>
            </TouchableOpacity>
          </View>
        )}

        {(() => {
          // Location off → coords never arrive, so explain rather than spin forever.
          if (locationDenied) {
            return (
              <View style={styles.emptyCard}>
                <Ionicons name="location-outline" size={32} color={Colors.muted} />
                <Text style={[styles.emptyCardText, { textAlign: 'center' }]}>
                  Turn on location to see models near you. You can enable it in your device settings.
                </Text>
              </View>
            )
          }
          // Waiting on GPS (coords null) or the first RPC fetch → show finding state.
          if (nearbyLoading) {
            return (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={Colors.roseDark} />
                <Text style={styles.emptyCardText}>Finding models near you…</Text>
              </View>
            )
          }
          // Distance is computed + radius-filtered + sorted (ascending) server-side by the
          // nearby_models RPC. Only name/attribute/verified filtering remains client-side.
          const q = modelSearch.trim().toLowerCase()
          const filtered = nearbyModels.filter(m => {
            if (blockedIds.has(m.id)) return false
            if (q && !m.name.toLowerCase().includes(q)) return false
            if (filterHairColour && m.hair_colour !== filterHairColour) return false
            if (filterHairType && m.hair_type !== filterHairType) return false
            if (filterHairLength && m.hair_length !== filterHairLength) return false
            if (filterSkinTone && m.skin_tone !== filterSkinTone) return false
            if (filterVerified && !m.is_verified) return false
            return true
          })
          const hasActiveFilter = !!(q || filterHairColour || filterHairType || filterHairLength || filterSkinTone || filterVerified || filterDistanceMi != null)
          return filtered.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={32} color={Colors.muted} />
              <Text style={[styles.emptyCardText, { textAlign: 'center' }]}>
                {hasActiveFilter
                  ? 'No models match your filters — few have added hair and skin details yet, so try clearing them.'
                  : 'No models nearby yet — share Guinea Pig to grow your community'}
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modelsStrip}
            >
              {filtered.map(m => (
                <NearbyModelCard
                  key={m.id}
                  model={m}
                  onInvite={() => handleInvite(m)}
                  onViewProfile={() => goModelProfile(m.id)}
                />
              ))}
            </ScrollView>
          )
        })()}
      </ScrollView>

      <PhotoViewerModal uri={enlargedPhoto} onClose={() => setEnlargedPhoto(null)} />
    </View>
  )
}

// ── Pending card ──────────────────────────────────────────────────────────────

function PendingCard({
  session: s,
  processing,
  onAccept,
  onDecline,
  onPhotoPress,
}: {
  session: SessionCard
  processing: boolean
  onAccept: () => void
  onDecline: () => void
  onPhotoPress: (uri: string) => void
}) {
  const catColor = categoryColor(s.treatmentCategory)
  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionCardRow}>
        {/* Avatar */}
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.sessionAvatar} />
        ) : (
          <View style={styles.sessionAvatarPlaceholder}>
            <Ionicons name="person" size={18} color={Colors.muted} />
          </View>
        )}
        {/* Info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.sessionModelName}>{s.modelName}</Text>
            <Text style={styles.sessionAgo}>{timeAgo(s.created_at)}</Text>
          </View>
          <View style={styles.sessionMeta}>
            {s.treatmentName && (
              <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                <Text style={[styles.treatPillText, { color: catColor }]}>{s.treatmentName}</Text>
              </View>
            )}
            <Text style={styles.sessionDateTime}>
              {formatSessionDate(s.date)} · {formatTime(s.start_time)} – {formatTime(s.end_time)}
            </Text>
          </View>
          {s.note ? (
            <Text style={styles.sessionNote} numberOfLines={2}>"{s.note}"</Text>
          ) : null}
        </View>
      </View>
      {/* What the model shared, so the stylist can judge the job before accepting.
         Full card width rather than inside the avatar column — the thumbs need room. */}
      <ApplicationPhotos photos={s.photoUrls} onPress={onPhotoPress} />
      {/* Buttons */}
      <View style={styles.sessionActions}>
        <TouchableOpacity
          style={styles.declineBtn}
          onPress={onDecline}
          disabled={processing}
          activeOpacity={0.85}
        >
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.acceptBtn, processing && { opacity: 0.6 }]}
          onPress={onAccept}
          disabled={processing}
          activeOpacity={0.9}
        >
          {processing ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={Colors.white} />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Upcoming card ─────────────────────────────────────────────────────────────

function UpcomingCard({
  session: s,
  onChat,
}: {
  session: SessionCard
  onChat: () => void
}) {
  const catColor = categoryColor(s.treatmentCategory)
  return (
    <View style={[styles.sessionCard, styles.upcomingCardH]}>
      {/* Model + date/time */}
      <View style={styles.upcomingHeader}>
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.sessionAvatar} />
        ) : (
          <View style={styles.sessionAvatarPlaceholder}>
            <Ionicons name="person" size={18} color={Colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionModelName} numberOfLines={1}>{s.modelName}</Text>
          <Text style={styles.sessionDateTime} numberOfLines={1}>
            {formatSessionDate(s.date)} · {formatTime(s.start_time)}
          </Text>
        </View>
      </View>

      {/* Treatment */}
      {s.treatmentName && (
        <View style={[styles.treatPill, styles.upcomingTreatPill, { backgroundColor: catColor + '22' }]}>
          <View style={[styles.treatDot, { backgroundColor: catColor }]} />
          <Text style={[styles.treatPillText, { color: catColor }]} numberOfLines={1}>{s.treatmentName}</Text>
        </View>
      )}

      {/* Chat */}
      <TouchableOpacity
        style={[styles.chatBtn, styles.upcomingChatBtn]}
        onPress={onChat}
        activeOpacity={0.8}
      >
        <Ionicons name="chatbubble-outline" size={16} color={Colors.roseDark} />
        <Text style={styles.chatBtnText}>Chat</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Filter chips ──────────────────────────────────────────────────────────────

function FilterChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: string[]
  selected: string | null
  onSelect: (v: string) => void
}) {
  return (
    <View style={nearbyStyles.filterGroup}>
      <Text style={nearbyStyles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
        {options.map(opt => {
          const active = selected === opt
          return (
            <TouchableOpacity
              key={opt}
              style={[nearbyStyles.chip, active && nearbyStyles.chipActive]}
              onPress={() => onSelect(opt)}
              activeOpacity={0.8}
            >
              <Text style={[nearbyStyles.chipText, active && nearbyStyles.chipTextActive]}>{opt}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

// ── Nearby model card (horizontal strip) ──────────────────────────────────────

function NearbyModelCard({ model, onInvite, onViewProfile }: { model: ModelCard; onInvite: () => void; onViewProfile: () => void }) {
  const initials = model.name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  const firstName = model.name.split(' ')[0] ?? model.name
  return (
    <TouchableOpacity style={nearbyStyles.card} onPress={onViewProfile} activeOpacity={0.88}>
      <View style={{ alignItems: 'center' }}>
        {model.profile_pic_url ? (
          <Image source={{ uri: model.profile_pic_url }} style={nearbyStyles.avatar} />
        ) : (
          <View style={nearbyStyles.avatarPlaceholder}>
            <Text style={nearbyStyles.avatarInitials}>{initials}</Text>
          </View>
        )}
        {model.is_verified && (
          <View style={nearbyStyles.verifiedBadge}>
            <Ionicons name="checkmark" size={8} color={Colors.white} />
          </View>
        )}
      </View>
      <Text style={nearbyStyles.name} numberOfLines={1}>{firstName}</Text>
      {model.distance != null && (
        <Text style={nearbyStyles.distanceText}>{formatDistance(model.distance)}</Text>
      )}
      <View style={nearbyStyles.attrChips}>
        {model.hair_colour && (
          <View style={nearbyStyles.attrChip}>
            <Text style={nearbyStyles.attrChipText} numberOfLines={1}>{model.hair_colour}</Text>
          </View>
        )}
        {model.skin_tone && (
          <View style={[nearbyStyles.attrChip, { backgroundColor: Colors.inputBg }]}>
            <Text style={[nearbyStyles.attrChipText, { color: Colors.roseDark }]} numberOfLines={1}>{model.skin_tone}</Text>
          </View>
        )}
      </View>
      <TouchableOpacity
        style={nearbyStyles.inviteBtn}
        onPress={e => { (e as any).stopPropagation?.(); onInvite() }}
        activeOpacity={0.85}
      >
        <Text style={nearbyStyles.inviteBtnText}>Invite</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

const nearbyStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 12,
    width: 130,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: Colors.softPink,
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { fontSize: 20, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  name: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.warmDark, textAlign: 'center' },
  distanceText: { fontSize: 11, color: Colors.muted, fontFamily: Fonts.body },
  attrChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  attrChip: {
    backgroundColor: Colors.softPink + '40',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 104,
  },
  attrChipText: { fontSize: 10, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: Colors.softPink + '60',
    borderWidth: 1,
    borderColor: Colors.rose + '40',
    marginTop: 2,
  },
  inviteBtnText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.roseDark },

  // Filter panel
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: Colors.softPink + '40',
    borderWidth: 1,
    borderColor: Colors.rose + '40',
    marginLeft: 'auto',
  },
  filterToggleActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  filterToggleText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.rose,
  },
  filterPanel: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  filterGroup: { gap: 6 },
  filterLabel: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  chipText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  chipTextActive: { color: Colors.white },
  clearFiltersBtn: { alignSelf: 'center', paddingVertical: 4 },
  clearFiltersText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.rose },
})

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  centred:   { alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyLabel: { fontSize: 15, color: Colors.muted, fontFamily: Fonts.bodyBold },
  goBackBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goBackText: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.warmDark },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  topBarLeft: { gap: 2, flexShrink: 1 },
  greeting:  { fontFamily: Fonts.display, fontSize: 24, color: Colors.rose, letterSpacing: -0.3 },
  subGreeting: { fontSize: 13, color: Colors.muted },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 12, flexShrink: 0 },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  headerAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  headerAvatarInitials: { fontSize: 16, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  verifiedDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Shop card
  shopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  shopCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shopStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  shopCardTitle: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  shopCardStatus: { fontSize: 12, fontFamily: Fonts.body, marginTop: 2 },
  publishLocked: { alignItems: 'flex-end', maxWidth: 128, gap: 5 },
  publishHint:   { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.pinkVibrant, textAlign: 'right', lineHeight: 15 },

  // Get-verified banner (under the shop toggle, until verified)
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.pinkVibrant,
    shadowColor: Colors.pinkVibrant,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  verifyBannerIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.pinkVibrant + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  verifyBannerTitle: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.warmDark, marginBottom: 2 },
  verifyBannerSub:   { fontSize: 12, color: Colors.muted, lineHeight: 16 },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: Colors.warmDark,
    letterSpacing: -0.2,
  },
  badge: {
    backgroundColor: Colors.roseDark,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.white },

  // Empty card
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyCardText: { fontSize: 14, color: Colors.muted, fontFamily: Fonts.body },

  // Treatments to review
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 18,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewAvatar: { width: 44, height: 44, borderRadius: 22 },
  reviewAvatarPlaceholder: { backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarInitial: { fontSize: 18, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  reviewName: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  reviewMeta: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  reviewPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.rose, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0,
  },
  reviewPillText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.white },

  // Session cards (shared)
  sessionCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  sessionCardRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 2,
  },

  // Upcoming treatments — horizontal swipeable cards
  upcomingScroll: {
    gap: 12,
    paddingRight: 16,
    paddingBottom: 4,
  },
  upcomingCardH: {
    width: 230,
    marginBottom: 4,
  },
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  upcomingTreatPill: {
    alignSelf: 'flex-start',
    marginTop: 12,
    maxWidth: '100%',
  },
  upcomingChatBtn: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 12,
  },
  sessionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  sessionAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  sessionModelName: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  sessionAgo: {
    fontSize: 11,
    color: Colors.muted,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  treatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  treatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  treatPillText: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
  },
  sessionDateTime: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Fonts.body,
  },
  sessionNote: {
    fontSize: 12,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
  },

  // Pending actions
  sessionActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  declineBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  acceptBtn: {
    flex: 2,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.roseDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  acceptBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },

  // Chat button (upcoming card)
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.softPink + '40',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'center',
    flexShrink: 0,
  },
  chatBtnText: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },

  // Quick links
  quickLinks: { gap: 10 },
  quickLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  quickLinkIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickLinkText: { flex: 1 },
  quickLinkTitle: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  quickLinkSub: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },

  modelSearchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 12,
  },
  modelSearchInput: {
    flex: 1, fontSize: 14, color: Colors.warmDark, padding: 0,
  },
  modelsStrip: {
    paddingBottom: 4, gap: 10,
  },
})
