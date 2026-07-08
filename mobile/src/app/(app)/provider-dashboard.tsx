import { useState, useCallback, useEffect } from 'react'
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
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'
import HeaderIcons from '@/components/HeaderIcons'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  nails:      CategoryColors.nails,
  lashes:     '#1D9E75',
  brows:      '#BA7517',
  hair:       '#7B5EA7',
  makeup:     '#E8845E',
  'spray tan':'#C99A4E',
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
  created_at: string
  status: 'pending' | 'accepted'
  modelName: string
  modelPicUrl: string | null
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
      <Ionicons name={icon as any} size={20} color={Colors.roseDark} />
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {hint ? <Text style={statStyles.hint}>{hint}</Text> : null}
    </View>
  )
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 10,
    color: Colors.roseDark,
    fontWeight: '600',
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
  const [pendingSessions,   setPendingSessions]   = useState<SessionCard[]>([])
  const [upcomingSessions,  setUpcomingSessions]  = useState<SessionCard[]>([])
  const [stats,             setStats]             = useState<Stats>({ totalSessions: 0, portfolioCount: 0 })
  const [nearbyModels,      setNearbyModels]      = useState<ModelCard[]>([])
  const [nearbyLoading,     setNearbyLoading]     = useState(true)
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

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) return
    if (!isRefresh) setLoading(true)
    setLoadError(false)

    try {
      // Phase 1: fetch user profile + provider row in parallel; derive display name from users
      const [{ data: userRow }, { data: provRow }] = await Promise.all([
        supabase.from('users').select('first_name, last_initial, profile_pic_url, is_verified').eq('id', userId).single(),
        supabase.from('providers').select('id, user_id, bio, is_published, shop_handle, rating, review_count').eq('user_id', userId).maybeSingle(),
      ])

      const userVerified = !!(userRow as any)?.is_verified
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
          Alert.alert(
            'Provider row insert failed',
            `code: ${insertErr.code}\nmessage: ${insertErr.message}\ndetails: ${insertErr.details ?? '—'}\nhint: ${insertErr.hint ?? '—'}`,
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
      ] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, model_user_id, date, start_time, end_time, treatment_id, note, created_at')
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
      ])

      setStats({
        totalSessions: totalCount ?? 0,
        portfolioCount: portfolioCount ?? 0,
      })

      // NOTE: nearby models are fetched separately in their own effect below, which
      // re-runs on [providerLat, providerLng, filterDistanceMi] since the RPC computes
      // distance at fetch time and those are its inputs.

      // Phase 3: enrich sessions with model + treatment info
      const allSessions = [...(pendingData ?? []), ...(upcomingData ?? [])]
      if (allSessions.length === 0) {
        setPendingSessions([])
        setUpcomingSessions([])
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

      const [{ data: modelsData }, { data: treatsData }] = await Promise.all([
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
      ])

      const modelMap: Record<string, any>  = {}
      const treatMap: Record<string, any>  = {}
      ;(modelsData ?? []).forEach((m: any) => { modelMap[m.id] = m })
      ;(treatsData ?? []).forEach((t: any) => { treatMap[t.id] = t })

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
          created_at: s.created_at,
          status: s.status,
          modelName: m ? `${m.first_name} ${m.last_initial ? m.last_initial + '.' : ''}`.trim() : 'Model',
          modelPicUrl: m?.profile_pic_url ?? null,
          treatmentName: t?.name ?? null,
          treatmentCategory: t?.category ?? null,
        }
      }

      setPendingSessions((pendingData ?? []).map(enrich))
      setUpcomingSessions((upcomingData ?? []).map(enrich))
    } catch (e) {
      console.error('provider-dashboard load failed:', e)
      setLoadError(true)
    }

    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!userId) return
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(async loc => {
        const lat = loc.coords.latitude
        const lng = loc.coords.longitude
        setProviderLat(lat)
        setProviderLng(lng)
        await Promise.all([
          supabase.from('users').update({ latitude: lat, longitude: lng }).eq('id', userId),
          supabase.from('providers').update({ latitude: lat, longitude: lng }).eq('user_id', userId),
        ]).catch(() => {})
      }).catch(() => {})
    }).catch(() => {})
  }, [userId])

  // ── Nearby models ────────────────────────────────────────────────────────────
  // The nearby_models RPC computes distance at fetch time, so this must re-run when
  // its inputs change — hence its own effect keyed on [providerLat, providerLng,
  // filterDistanceMi], separate from load()'s [userId]. Cold-load waits for GPS
  // (coords start null); a distance-filter change refetches.
  useEffect(() => {
    // Guard: no coords yet (GPS still resolving) → skip RPC, stay in loading state.
    if (providerLat == null || providerLng == null) {
      setNearbyLoading(true)
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
          // NOTE: hair/skin attributes are NOT returned by the nearby_models RPC yet —
          // set null for now (cards drop the attr chips; hair/skin filters won't match).
          hair_colour:     null,
          hair_type:       null,
          hair_length:     null,
          skin_tone:       null,
          is_verified:     !!(m.is_verified),
          distance:        m.distance_mi ?? null,
        })))
      }
      setNearbyLoading(false)
    })()
    return () => { cancelled = true }
  }, [providerLat, providerLng, filterDistanceMi])

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

    // Only a verified provider can go live — the DB blocks is_published=true for
    // unverified providers, so guard here too (the UI toggle is disabled for them).
    if (value && !provider.is_verified) {
      Alert.alert('Verify first', 'Get verified to make your shop live.')
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
            {provider.is_verified && (
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
            <View style={[styles.shopStatusDot, { backgroundColor: isPublished ? '#1D9E75' : Colors.muted }]} />
            <View>
              <Text style={styles.shopCardTitle}>Shop status</Text>
              <Text style={[styles.shopCardStatus, { color: isPublished ? '#1D9E75' : Colors.muted }]}>
                {isPublished ? 'Live — models can find you' : 'Offline — hidden from search'}
              </Text>
            </View>
          </View>
          {publishLoading ? (
            <ActivityIndicator size="small" color={Colors.roseDark} />
          ) : provider.is_verified ? (
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
              <Text style={styles.publishHint}>Verify to make your shop live</Text>
            </View>
          )}
        </View>

        {/* ── Get verified banner (hidden once verified) ── */}
        {!provider.is_verified && (
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
              <Text style={styles.verifyBannerTitle}>Get verified</Text>
              <Text style={styles.verifyBannerSub}>Verify your identity to make your shop live and start getting bookings.</Text>
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
              label="Treatments"
              value={stats.totalSessions.toString()}
              icon="calendar-outline"
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
            <Ionicons name="checkmark-circle-outline" size={32} color={Colors.muted} />
            <Text style={styles.emptyCardText}>All applications reviewed</Text>
          </View>
        ) : (
          pendingSessions.map(s => (
            <PendingCard
              key={s.id}
              session={s}
              processing={processingIds.has(s.id)}
              onAccept={() => acceptSession(s)}
              onDecline={() => declineSession(s)}
            />
          ))
        )}

        {/* ── Upcoming sessions ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Upcoming treatments</Text>
        </View>

        {upcomingSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={Colors.muted} />
            <Text style={styles.emptyCardText}>No confirmed treatments yet</Text>
          </View>
        ) : (
          upcomingSessions.map(s => (
            <UpcomingCard
              key={s.id}
              session={s}
              onChat={() => goChat(s.id)}
            />
          ))
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
            <View style={[styles.quickLinkIcon, { backgroundColor: '#E8845E26' }]}>
              <Ionicons name="pencil-outline" size={22} color="#E8845E" />
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
            <TouchableOpacity onPress={() => setModelSearch('')}>
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
              options={['1 mi','2 mi','4 mi','10 mi','20 mi']}
              selected={filterDistanceMi != null ? `${filterDistanceMi} mi` : null}
              onSelect={v => {
                const parsed = v ? parseInt(v) : null
                setFilterDistanceMi(parsed === filterDistanceMi ? null : parsed)
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
              <Text style={styles.emptyCardText}>
                {hasActiveFilter ? 'No models match your filters' : 'No models nearby yet — share Guinea Pig to grow your community'}
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
    </View>
  )
}

// ── Pending card ──────────────────────────────────────────────────────────────

function PendingCard({
  session: s,
  processing,
  onAccept,
  onDecline,
}: {
  session: SessionCard
  processing: boolean
  onAccept: () => void
  onDecline: () => void
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
    <View style={styles.sessionCard}>
      <View style={styles.sessionCardRow}>
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.sessionAvatar} />
        ) : (
          <View style={styles.sessionAvatarPlaceholder}>
            <Ionicons name="person" size={18} color={Colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionModelName}>{s.modelName}</Text>
          <View style={styles.sessionMeta}>
            {s.treatmentName && (
              <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                <Text style={[styles.treatPillText, { color: catColor }]}>{s.treatmentName}</Text>
              </View>
            )}
            <Text style={styles.sessionDateTime}>
              {formatSessionDate(s.date)} · {formatTime(s.start_time)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.chatBtn}
          onPress={onChat}
          activeOpacity={0.8}
        >
          <Ionicons name="chatbubble-outline" size={16} color={Colors.roseDark} />
          <Text style={styles.chatBtnText}>Chat</Text>
        </TouchableOpacity>
      </View>
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
          <View style={[nearbyStyles.attrChip, { backgroundColor: '#E8845E18' }]}>
            <Text style={[nearbyStyles.attrChipText, { color: '#B5603A' }]} numberOfLines={1}>{model.skin_tone}</Text>
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
  avatarInitials: { fontSize: 20, fontWeight: '700', color: Colors.roseDark },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  name: { fontSize: 13, fontWeight: '700', color: Colors.warmDark, textAlign: 'center' },
  distanceText: { fontSize: 11, color: Colors.muted, fontWeight: '500' },
  attrChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  attrChip: {
    backgroundColor: Colors.softPink + '40',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 104,
  },
  attrChipText: { fontSize: 10, fontWeight: '600', color: Colors.roseDark },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: Colors.softPink + '60',
    borderWidth: 1,
    borderColor: Colors.rose + '40',
    marginTop: 2,
  },
  inviteBtnText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },

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
  filterToggleText: { fontSize: 12, fontWeight: '700', color: Colors.roseDark },
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
  filterLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.warmDark },
  chipTextActive: { color: Colors.white },
  clearFiltersBtn: { alignSelf: 'center', paddingVertical: 4 },
  clearFiltersText: { fontSize: 13, fontWeight: '600', color: Colors.rose },
})

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  centred:   { alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyLabel: { fontSize: 15, color: Colors.muted, fontWeight: '600' },
  goBackBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goBackText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },

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
  topBarLeft: { gap: 2 },
  greeting:  { fontFamily: 'DancingScript_700Bold', fontSize: 33, color: Colors.warmDark, letterSpacing: -0.5 },
  subGreeting: { fontSize: 13, color: Colors.muted },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  headerAvatarInitials: { fontSize: 16, fontWeight: '700', color: Colors.roseDark },
  verifiedDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1D9E75',
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
  shopCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.warmDark },
  shopCardStatus: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  publishLocked: { alignItems: 'flex-end', maxWidth: 128, gap: 5 },
  publishHint:   { fontSize: 12, fontWeight: '700', color: Colors.pinkVibrant, textAlign: 'right', lineHeight: 15 },

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
  verifyBannerTitle: { fontSize: 15, fontWeight: '800', color: Colors.warmDark, marginBottom: 2 },
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
    fontFamily: 'DancingScript_700Bold',
    fontSize: 25,
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  badge: {
    backgroundColor: Colors.roseDark,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.white },

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
  emptyCardText: { fontSize: 14, color: Colors.muted, fontWeight: '500' },

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
    fontWeight: '700',
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
    fontWeight: '700',
  },
  sessionDateTime: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
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
    fontWeight: '600',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
